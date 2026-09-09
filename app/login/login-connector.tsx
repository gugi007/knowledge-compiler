"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/frontend/routes";
import { ImportPanel } from "./import-panel";

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

/** OAuth 回跳冻结契约：成功 /?auth=connected，失败 /?authError=<reason>。 */
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
 * 承诺文案留在 server component（login-screen.tsx）里不进客户端 bundle，
 * 这里只管「连了没、连得上吗、连了之后干什么」。
 *
 * 状态流转：
 * - loading：首帧查 status
 * - connected：status.connected===true（已授权），下面挂 ImportPanel
 *   （读创作列表 → 勾选 → 导入 → 摘要 → 去编译），细节见 import-panel.tsx
 * - ready：status.ready===true 且未连接（OAuth 已配置，可跳转授权）
 * - offline：status.ready===false（missing 非空，降级演示模式）
 * - error：fetch status 失败（网络断 / 500），给重试 + 演示入口
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
      // 网络断 / 500 / 响应非 JSON：不得空屏，降级到 error 态给重试 + 演示入口。
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
    <div className="mt-8 flex flex-col items-center gap-4">
      {/* 失败回跳提示 */}
      {authErrorReason && (
        <p className="w-full max-w-md rounded-xl border border-red-500/25 bg-red-50 p-3 text-sm leading-6 text-red-700">
          {describeAuthError(authErrorReason)}
          {status && status.missing.length > 0 && (
            <span className="mt-1 block font-mono text-[11px] text-red-500/80">
              未配置：{status.missing.join("、")}
            </span>
          )}
        </p>
      )}

      {/* origin 不一致诊断 */}
      {originMismatch && (
        <p className="w-full max-w-md rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-[12px] leading-5 text-amber-800">
          本机调试 origin 与登记的 redirect_uri 不一致——跳转知乎授权会被拒绝。
          请检查 ZHIHU_OAUTH_REDIRECT_URI 是否指向当前页面地址。
        </p>
      )}

      {/* loading：首帧查 status */}
      {state === "loading" && (
        <button
          className="w-full max-w-xs cursor-wait rounded-full bg-coral px-6 py-3 text-sm font-bold text-white opacity-60 sm:w-auto"
          disabled
          type="button"
        >
          正在检查连接状态…
        </button>
      )}

      {/* ready：未连接但 OAuth 已配置，给主操作 */}
      {state === "ready" && (
        <a
          className="w-full max-w-xs rounded-full bg-coral px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-[#004bbb] sm:w-auto"
          href={ZHIHU_LOGIN_HREF}
        >
          登录并编译我的知识
        </a>
      )}

      {/* connected：已授权，展示状态 + 去编译 / 看空间 + 断开 */}
      {state === "connected" && status && (
        <div className="w-full max-w-md">
          {justConnected && (
            <p className="mb-3 rounded-xl border border-emerald-300/50 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">
              ✓ 知乎已连接
            </p>
          )}
          <div className="rounded-xl border border-ink/10 bg-white p-4 text-left">
            <div className="flex items-center gap-2">
              <span className="status-dot" />
              <span className="text-sm font-bold">已连接知乎</span>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-[9px] font-bold tracking-wider text-ink/40 uppercase">创作</dt>
                <dd className="font-display text-lg">{status.contentsCount}</dd>
              </div>
              <div>
                <dt className="text-[9px] font-bold tracking-wider text-ink/40 uppercase">已导入</dt>
                <dd className="font-display text-lg">{status.importedCount}</dd>
              </div>
              <div>
                <dt className="text-[9px] font-bold tracking-wider text-ink/40 uppercase">产物</dt>
                <dd className="font-display text-lg">{status.hasDataset ? "有" : "—"}</dd>
              </div>
            </dl>
            <p className="mt-2 font-mono text-[10px] text-ink/35">
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

          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            {status.hasDataset ? (
              <Link
                className="rounded-full bg-coral px-6 py-3 text-sm font-bold text-white transition hover:bg-[#004bbb]"
                href={`${ROUTES.space}?source=compiled`}
              >
                查看我的知识空间 →
              </Link>
            ) : status.importedCount > 0 ? (
              /*
                corpus=imported 是给第二幕的信号：/api/compile 认这个语料
                （编的是会话里刚导入的文章）。但共享的 useCompile 目前 POST 不带
                body，第二幕收到这个 query 也会照编 demo。缺口见交接报告 CCR-1。
              */
              <Link
                className="rounded-full bg-coral px-6 py-3 text-sm font-bold text-white transition hover:bg-[#004bbb]"
                href={`${ROUTES.compile}?corpus=imported`}
              >
                去编译我的知识 →
              </Link>
            ) : null}
            <button
              className="rounded-full border border-ink/15 bg-white px-5 py-3 text-sm font-bold text-ink/60 transition hover:border-ink/30 hover:text-ink/80 disabled:opacity-50"
              disabled={logoutPending}
              onClick={() => void handleLogout()}
              type="button"
            >
              {logoutPending ? "断开中…" : "断开连接"}
            </button>
          </div>

          {/*
            一篇都没导入时不给「去编译我的知识」——第二幕现在只会编 demo，
            给它挂这个名字是假承诺。想看编译台就走这条明确标了示例语料的退路。
          */}
          {status.importedCount === 0 && (
            <p className="mt-2 text-center text-[11px] leading-5 text-ink/40">
              也可以
              <Link
                className="font-bold text-ink/55 underline underline-offset-2 transition hover:text-coral"
                href={ROUTES.compile}
              >
                用示例语料先看编译台 →
              </Link>
            </p>
          )}
        </div>
      )}

      {/* offline：OAuth 未配置全，降级演示模式 */}
      {state === "offline" && status && (
        <div className="w-full max-w-md">
          <button
            className="w-full cursor-not-allowed rounded-full bg-coral px-6 py-3 text-sm font-bold text-white opacity-45"
            disabled
            type="button"
          >
            登录并编译我的知识
          </button>
          <p className="mt-3 text-[12px] leading-5 text-ink/50">
            知乎 OAuth 未配置完成，暂无法连接。缺少：
            <span className="font-mono text-ink/70">
              {" "}{status.missing.join("、")}
            </span>
            。可先进入演示模式体验完整流程。
          </p>
          <Link
            className="mt-3 inline-block rounded-full bg-coral px-6 py-3 text-sm font-bold text-white transition hover:bg-[#004bbb]"
            href={ROUTES.compile}
          >
            进入演示模式 →
          </Link>
        </div>
      )}

      {/* error：查 status 失败，给重试 + 演示入口 */}
      {state === "error" && (
        <div className="w-full max-w-md">
          <p className="rounded-xl border border-red-500/25 bg-red-50 p-3 text-sm leading-6 text-red-700">
            无法读取连接状态。请检查网络或服务端是否运行后重试。
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <button
              className="rounded-full border border-ink/15 bg-white px-5 py-3 text-sm font-bold text-ink/70 transition hover:border-ink/30 hover:text-ink"
              onClick={() => {
                setState("loading");
                void fetchStatus();
              }}
              type="button"
            >
              重试
            </button>
            <Link
              className="rounded-full bg-coral px-6 py-3 text-sm font-bold text-white transition hover:bg-[#004bbb]"
              href={ROUTES.compile}
            >
              进入演示模式 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
