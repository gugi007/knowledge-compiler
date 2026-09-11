"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/frontend/routes";
import { ImportPanel } from "./import-panel";
import styles from "./login.module.css";

/**
 * /api/zhihu/status 响应里前端需要消费的字段子集。
 *
 * 完整响应还含凭证指纹（configured / length / sha256Prefix）与 redirectUri 明文，
 * 这里不声明——前端不展示凭证，多声明只会让维护者误以为这些值可用于 UI。
 * 后端 route.ts（app/api/zhihu/status）是事实源，形状变了要同步改这里。
 */
interface ZhihuStatus {
  /** OAuth 四项环境变量是否全部配置完成。false 即 missing 非空，前端降级为演示模式。 */
  ready: boolean;
  /** 缺失的环境变量名，演示模式里告诉用户为什么连不了。 */
  missing: string[];
  /** 是否已连接（有有效会话）。 */
  connected: boolean;
  /** 会话剩余秒数，0 表示无会话。非秘密值，仅用于提示即将过期。 */
  sessionExpiresInSec: number;
  /** 已拉取的知乎创作条数。 */
  contentsCount: number;
  /** 已导入编译管线的条数。 */
  importedCount: number;
  /** 是否已有编译产物，决定连接后去编译台还是直达空间。 */
  hasDataset: boolean;
  /** 当前页面 origin 与登记的 redirect_uri origin 是否一致。false 时知乎会拒绝跳转。 */
  originMatchesRedirect: boolean;
}

type LoginState = "loading" | "connected" | "ready" | "offline" | "error";

/**
 * OAuth 回跳冻结契约：成功 /compile?corpus=imported，失败 /?authError=<reason>。
 * 成功不再回本页——callback 直接把人送去编译台。失败回跳仍落在登录页，
 * 由下面的 authErrorReason 读取并展示，所以两个参数常量都还在这里用。
 */
const AUTH_CONNECTED_PARAM = "auth";
const AUTH_ERROR_PARAM = "authError";

/** 登录跳转端点。是 API 路由不是页面路由，不走 ROUTES 常量（那是页面导航用的）。 */
const ZHIHU_LOGIN_HREF = "/api/auth/zhihu/login";

/**
 * 把 authError 的原始 reason 映射成对用户友好的文案。
 * reason 来自 app/api/auth/zhihu/login 与 callback 两个 route 的 back() 调用，
 * 保留原始值片段便于开发者诊断。映射表要跟着那两个路由的 reason 字面量同步。
 */
function describeAuthError(reason: string): string {
  if (reason.startsWith("missing-config:")) {
    const items = reason.slice("missing-config:".length);
    return `知乎 OAuth 未配置完整（缺 ${items}）。请先在服务端设置环境变量后重试。`;
  }
  if (reason.startsWith("denied:")) {
    return `你取消了授权（${reason.slice("denied:".length)}）。`;
  }
  if (reason === "no-code") return "知乎回跳时没有带授权码，授权流程中断。";
  if (reason === "state-missing" || reason === "state-expired") {
    return "授权状态已过期，请重新连接。";
  }
  if (reason === "state-mismatch") {
    return "授权状态校验不通过，可能是跨标签页或会话被串改。";
  }
  if (reason.startsWith("exchange:")) {
    // exchange 后面跟的是 ZhihuAuthError.message，已经是人话。
    return reason.slice("exchange:".length);
  }
  if (reason === "exchange-failed") return "换取访问令牌失败，请稍后重试。";
  return `授权失败：${reason}`;
}

/** 把剩余秒数格式化成「m 分 s 秒」，用于会话过期提示。 */
function formatRemaining(sec: number): string {
  if (sec <= 0) return "已过期";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

/**
 * 第一幕的交互核心：状态机 + OAuth 跳转 + 演示退路。
 *
 * 版式归属：本组件渲染在 login-screen 主标题/副标题之下、分隔线之上，
 * 即参考页里「登录按钮」所在的槽位（.actions）。按钮/提示的视觉全部走
 * login.module.css 的蓝色体系；真实行为与上一版完全一致。
 *
 * 状态流转：
 * - loading：首帧查 status（禁用态主按钮 + 等待文案）
 * - connected：status.connected===true（已授权），下面挂 ImportPanel
 *   （读创作列表 → 勾选 → 导入 → 摘要 → 去编译），细节见 import-panel.tsx
 * - ready：status.ready===true 且未连接（OAuth 已配置，可跳转授权）→ 主登录按钮
 * - offline：status.ready===false（missing 非空，降级演示模式）→ 禁用按钮 + 离线说明
 *   （演示退路由 login-screen 常驻的两张演示卡兜底）
 * - error：fetch status 失败（网络断 / 500），给重试（演示退路同上）
 */
export function LoginConnector() {
  const [state, setState] = useState<LoginState>("loading");
  const [status, setStatus] = useState<ZhihuStatus | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);

  // OAuth 回跳参数在初始化时就读取（lazy initializer），不放进 effect——
  // effect 里同步 setState 会触发 cascading renders 警告。
  // SSR 时 window 不存在，返回空值；客户端 hydration 时读到真实值。
  // 这两个参数只在 OAuth 回跳时出现，常见路径无 hydration 差异。
  /** 成功回跳标记：连上后在 connected 态上额外显示一条成功提示。 */
  const [justConnected, setJustConnected] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      new URLSearchParams(window.location.search).get(AUTH_CONNECTED_PARAM) ===
      "connected"
    );
  });
  /** 失败回跳原因（已 decodeURIComponent）。只在挂载时从 URL 读一次，之后不再变。 */
  const [authErrorReason] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const error = new URLSearchParams(window.location.search).get(
      AUTH_ERROR_PARAM,
    );
    return error ? decodeURIComponent(error) : null;
  });

  // status 只有一份 fetch 实现：状态机推进、重试、导入后的静默刷新都复用它。
  // 它只回数据不碰 state——失败要不要降级成 error 态由调用方决定。
  const loadStatus = useCallback(async (): Promise<ZhihuStatus | null> => {
    try {
      const res = await fetch("/api/zhihu/status", { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as ZhihuStatus;
    } catch {
      // 网络断 / 500 / 响应非 JSON 都归到这里，由调用方降级，不空屏。
      return null;
    }
  }, []);

  // 把 status 投影成状态机取值：已连接 > 可连接 > 未配置。
  const applyStatus = useCallback((data: ZhihuStatus) => {
    setStatus(data);
    if (data.connected) {
      setState("connected");
    } else if (data.ready) {
      setState("ready");
    } else {
      setState("offline");
    }
  }, []);

  // fetchStatus 依赖为空，引用稳定——useEffect 把它放进依赖也只在挂载时跑一次。
  // 不在开头 setState("loading")：首帧的 loading 由 useState 初始值覆盖，
  // 重试/断开由各自的 onClick 在调用前设，避免 effect 内同步 setState。
  const fetchStatus = useCallback(async () => {
    const data = await loadStatus();
    if (!data) {
      setStatus(null);
      setState("error");
      return;
    }
    applyStatus(data);
  }, [applyStatus, loadStatus]);

  // 导入后只想要最新的计数与 hasDataset，不想被一次偶发失败踢回 error 态，
  // 所以刷新失败时保持原状（面板上的数字旧一拍，比整块退回错误态好）。
  const refreshStatusQuietly = useCallback(async () => {
    const data = await loadStatus();
    if (data) setStatus(data);
  }, [loadStatus]);

  // 挂载时：清掉 URL 里的 OAuth 回跳参数（防刷新重放）+ 查 status。
  // 参数本身在 useState 初始化时已读取，这里只负责清理地址栏。
  // effect 里只做「await 之后再写 state」的 async IIFE，不触发
  // react-hooks/set-state-in-effect 的同步 cascading renders 警告。
  // loadStatus / applyStatus 都是稳定引用，所以这段只在挂载时跑一次。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get(AUTH_CONNECTED_PARAM);
    const error = params.get(AUTH_ERROR_PARAM);

    // 处理完即清参数，防刷新重放。replaceState 不触发导航，只改地址栏。
    if (connected || error) {
      const url = new URL(window.location.href);
      url.searchParams.delete(AUTH_CONNECTED_PARAM);
      url.searchParams.delete(AUTH_ERROR_PARAM);
      window.history.replaceState({}, "", url.toString());
    }

    let cancelled = false;
    void (async () => {
      const data = await loadStatus();
      if (cancelled) return;
      // 网络断 / 500 / 响应非 JSON：不得空屏，降级到 error 态给重试（演示卡在面板下方常驻）。
      if (!data) {
        setStatus(null);
        setState("error");
        return;
      }
      applyStatus(data);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyStatus, loadStatus]);

  // 断开连接：POST /api/auth/zhihu/logout，成功后刷新状态回到 ready 或 offline。
  const handleLogout = useCallback(async () => {
    setLogoutPending(true);
    setState("loading");
    try {
      await fetch("/api/auth/zhihu/logout", { method: "POST" });
      setJustConnected(false);
      await fetchStatus();
    } finally {
      setLogoutPending(false);
    }
  }, [fetchStatus]);

  // origin 与 redirect_uri 不一致诊断：只在 OAuth 已配置全（ready===true）时才有意义，
  // 否则 redirectUri 可能根本没设，报「不一致」会误导。
  const originMismatch =
    status?.ready === true && status.originMatchesRedirect === false;

  return (
    <div className={styles.actions}>
      {/* 失败回跳提示 */}
      {authErrorReason && (
        <p className={styles.noticeError}>
          {describeAuthError(authErrorReason)}
          {status && status.missing.length > 0 && (
            <span className={styles.monoBlock}>
              未配置：{status.missing.join("、")}
            </span>
          )}
        </p>
      )}

      {/* origin 不一致诊断 */}
      {originMismatch && (
        <p className={styles.noticeWarn}>
          本机调试 origin 与登记的 redirect_uri 不一致——跳转知乎授权会被拒绝。
          请检查 ZHIHU_OAUTH_REDIRECT_URI 是否指向当前页面地址。
        </p>
      )}

      {/* loading：首帧查 status。主按钮原位换成等待态，不打断版式。 */}
      {state === "loading" && (
        <button
          className={`${styles.loginButton} ${styles.loginButtonBusy}`}
          disabled
          type="button"
        >
          <span className={styles.zhihuIcon}>知</span>
          <span>正在检查连接状态…</span>
        </button>
      )}

      {/* ready：未连接但 OAuth 已配置，主操作直连知乎授权（真实跳转，非 mockup 的 alert） */}
      {state === "ready" && (
        <a className={styles.loginButton} href={ZHIHU_LOGIN_HREF}>
          <span className={styles.zhihuIcon}>知</span>
          <span>登录并编译知识</span>
        </a>
      )}

      {/* connected：已授权，展示状态 + 导入闭环 + 去编译 / 看空间 + 断开 */}
      {state === "connected" && status && (
        <div className={styles.connectedWrap}>
          {justConnected && (
            <p className={styles.noticeOk}>✓ 知乎已连接</p>
          )}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.dot} />
              <span>已连接知乎</span>
            </div>
            <dl className={styles.stats}>
              <div>
                <dt className={styles.statsDt}>创作</dt>
                <dd className={styles.statsDd}>{status.contentsCount}</dd>
              </div>
              <div>
                <dt className={styles.statsDt}>已导入</dt>
                <dd className={styles.statsDd}>{status.importedCount}</dd>
              </div>
              <div>
                <dt className={styles.statsDt}>产物</dt>
                <dd className={styles.statsDd}>{status.hasDataset ? "有" : "—"}</dd>
              </div>
            </dl>
            <p className={styles.cardFoot}>
              会话剩余 {formatRemaining(status.sessionExpiresInSec)}
            </p>
          </div>
          {/*
            导入闭环：读创作列表 → 勾选 → 导入 → 结果摘要。
            只在 connected 块里渲染，断开/掉回其他态时随之卸载，本地选择自然作废。
          */}
          <ImportPanel
            importedCount={status.importedCount}
            onContentsRead={() => void refreshStatusQuietly()}
            onImported={() => void refreshStatusQuietly()}
            onRecheck={() => void fetchStatus()}
            reconnectHref={ZHIHU_LOGIN_HREF}
          />

          <div className={styles.row}>
            {status.hasDataset ? (
              <Link
                className={styles.primarySmall}
                href={`${ROUTES.space}?source=compiled`}
              >
                查看我的知识空间 →
              </Link>
            ) : status.importedCount > 0 || status.contentsCount > 0 ? (
              /*
                corpus=imported 是给第二幕的信号：第二幕读地址栏的 ?corpus= 后
                交给共享的 useCompile，由它写进 POST body，/api/compile 认这个语料，
                编的是会话里刚导入的文章。
                早先「useCompile 不带 body、这里会照编 demo」的缺口已闭合
                （见 use-compile 的 fetch body 与 compile-workspace 的 useCorpusParam），
                不要再按那个旧前提判断这条链接的效力。
              */
              <Link
                className={styles.primarySmall}
                href={`${ROUTES.compile}?corpus=imported`}
              >
                去编译我的知识 →
              </Link>
            ) : null}
            <button
              className={styles.ghostButton}
              disabled={logoutPending}
              onClick={() => void handleLogout()}
              type="button"
            >
              {logoutPending ? "断开中…" : "断开连接"}
            </button>
          </div>

          {/*
            演示语料退路的理由：只有当会话里既没有已导入文章、也没有预取的创作时，
            才不给「去编译我的知识」这条链接。此时下发 corpus=imported 确实没有语料
            可编（/api/compile 对 imported 语料是按需补齐：有已导入用已导入，没有就用
            预取的创作投影，两者都空才只剩「未连接 / 会话过期」的 400），所以退路是这条
            明确标了示例语料的 demo 编译（不带 query）。

            注意 importedCount 为零 ≠ 没东西可编：登录后的预取只写 session.contents，
            importedCount 要等用户在导入面板里手动点「导入这 N 篇」才非零，预取的那批创作
            在 contentsCount 里。判断「有没有东西可编」必须用两个字段的或。
            提示文案是「也可以…」，与主链接并存时不冲突，故此处仍单看 importedCount。
          */}
          {status.importedCount === 0 && (
            <p className={styles.hint}>
              也可以
              <Link
                className={styles.hintLink}
                href={ROUTES.compile}
              >
                {" "}
                用示例语料先看编译台 →
              </Link>
            </p>
          )}
        </div>
      )}

      {/* offline：OAuth 未配置全，禁用按钮 + 未配置说明（演示卡常驻下方兜底） */}
      {state === "offline" && status && (
        <>
          <button
            className={styles.loginButton}
            disabled
            type="button"
          >
            <span className={styles.zhihuIcon}>知</span>
            <span>登录并编译知识</span>
          </button>
          <p className={styles.notice}>
            知乎 OAuth 未配置完成，暂无法连接。缺少：
            <span className={styles.mono}> {status.missing.join("、")} </span>。
            你仍可通过下方两张演示卡，免登录体验示例空间与演示编译。
          </p>
        </>
      )}

      {/* error：查 status 失败（网络断 / 服务端未起），给重试（演示卡常驻下方兜底） */}
      {state === "error" && (
        <>
          <p className={styles.noticeError}>
            无法读取连接状态。请检查网络或服务端是否运行后重试。
          </p>
          <div className={styles.row}>
            <button
              className={styles.ghostButton}
              onClick={() => {
                setState("loading");
                void fetchStatus();
              }}
              type="button"
            >
              重试
            </button>
          </div>
        </>
      )}
    </div>
  );
}
