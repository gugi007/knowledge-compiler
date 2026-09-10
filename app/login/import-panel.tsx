"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 连接后的最小导入闭环：读创作列表 → 选 → 导入 → 报告结果。
 *
 * OWNER: login-agent
 *
 * 只在 connected 态由 LoginConnector 挂载，所以「首帧读列表」就是挂载时一次
 * fetch，不需要监听状态变化再决定要不要拉。断开连接时它随 connected 块一起卸载，
 * 本地列表与选择自动作废，不留脏数据。
 *
 * 承诺页气质：这里刻意不做表格——不展示正文、不做分页器、不做排序。
 * 用户只需要确认「读到的是我的东西」和「导入了多少」。
 *
 * 前端不读 OAuth token，也不请求全文；全部读写都走 /api/zhihu/contents 一个端点。
 */

/**
 * GET /api/zhihu/contents 单条创作里前端会消费的字段。
 *
 * 事实源是 app/api/zhihu/contents/route.ts：它把会话里的条目投影成展示字段，
 * 标题去过零宽字符，字数只有 summaryChars（开放平台不给正文全文，所以口径是摘要）。
 * createdAt / commentCount 不展示，因此不声明——多声明会让维护者以为可用于 UI。
 */
interface ZhihuContentsItem {
  url: string;
  /** 清洗后的标题，可能为空串。 */
  title: string;
  /** YYYY-MM-DD，服务端由 createdAt 推出。 */
  publishedAt: string;
  /** 摘要字数，不是正文全文。 */
  summaryChars: number;
  likeCount: number;
}

/** GET /api/zhihu/contents 的 2xx 响应。服务端还回 fetchedAt，前端不消费，故不声明。 */
interface ZhihuContentsResponse {
  totals: number;
  items: ZhihuContentsItem[];
}

/** POST /api/zhihu/contents 的响应里前端会消费的字段。 */
interface ZhihuImportResult {
  imported: number;
  /** 导入文本总字数（摘要口径）。 */
  totalChars: number;
  /** 选中但被服务端跳过的条目及原因（ID 解析失败、文本过短）。 */
  skipped: { title: string; reason: string }[];
  /** 选中但已不在会话列表里的条数。 */
  missing: number;
}

type ContentsPhase = "loading" | "ready" | "unauthorized" | "failed";

/** 一次「读创作列表」的结果，取数与落状态之间唯一的通道。 */
type ContentsOutcome =
  /** 已有更新的一次读取（或组件已卸载），这次结果作废。 */
  | { kind: "stale" }
  /** 401：会话过期，要的是重新连接而不是重试。 */
  | { kind: "unauthorized" }
  /** 网络断 / 非 2xx / 形状意外：给文案 + 重试。 */
  | { kind: "failed"; message: string }
  | { kind: "ok"; items: ZhihuContentsItem[]; totals: number; pages: number };

/** 列表读写共用同一个端点，GET 拉取、POST 导入。 */
const CONTENTS_HREF = "/api/zhihu/contents";
/** 首帧只读 1 页（每页 50 条），要看更多由按钮显式翻页。 */
const FIRST_PAGES = 1;
/** 与 app/api/zhihu/contents 的 MAX_PAGES 对齐；服务端本来也会夹，这里只是决定按钮何时消失。 */
const MAX_CONTENTS_PAGES = 5;
/** 结果摘要里最多列几条跳过原因，其余折叠成一句计数。 */
const MAX_SKIPPED_SHOWN = 3;

/** 非 2xx 时服务端返回 `{ error }`；拿不到就用 HTTP 状态兜底，绝不空屏。 */
function readApiError(
  payload: { error?: unknown } | null,
  status: number,
): string {
  if (typeof payload?.error === "string" && payload.error) return payload.error;
  if (status === 502) return "知乎开放平台没答上来（网关或上游错误），稍后重试。";
  if (status === 500) return "服务端配置不完整，读不到创作列表。";
  return `请求失败（HTTP ${status}）。`;
}

function formatChars(totalChars: number): string {
  if (totalChars >= 10000) return `${(totalChars / 10000).toFixed(1)} 万字`;
  return `${totalChars.toLocaleString("zh-CN")} 字`;
}

export interface ImportPanelProps {
  /** status.importedCount：刷新后仍已导入过时，用它提醒「重新导入会替换」。 */
  importedCount: number;
  /** 读到创作列表后让上层静默刷新 status，顶部「创作」计数才跟得上。 */
  onContentsRead: () => void;
  /** 导入成功后让上层静默刷新 status，主 CTA 与计数才会跟着变。 */
  onImported: () => void;
  /** 会话过期时让上层重查 status（服务端可能已判定未连接，需要退回 ready 态）。 */
  onRecheck: () => void;
  /** OAuth 跳转地址。是 API 路由，由上层持有，这里只负责放出去。 */
  reconnectHref: string;
}

export function ImportPanel({
  importedCount,
  onContentsRead,
  onImported,
  onRecheck,
  reconnectHref,
}: ImportPanelProps) {
  const [phase, setPhase] = useState<ContentsPhase>("loading");
  const [items, setItems] = useState<ZhihuContentsItem[]>([]);
  const [totals, setTotals] = useState(0);
  const [pages, setPages] = useState(FIRST_PAGES);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<ZhihuImportResult | null>(null);

  /**
   * 请求代次。点两次「重试」或翻页时叠在旧请求上，旧结果必须丢掉，
   * 否则后到的旧响应会把新列表覆盖回去。卸载时 ++ 即在途请求作废。
   */
  const reqRef = useRef(0);

  /**
   * 通知父组件用的两个回调走 ref 中转。父层传的是 inline lambda，身份每次渲染都变；
   * 一旦进了取数/落状态函数的依赖链，挂载 effect 就会重跑 → 重取列表 → 再通知 →
   * 无限循环。ref 在 effect 里更新（不在渲染期写），两个函数因此保持零依赖。
   */
  const notify = useRef({ onContentsRead, onImported });
  useEffect(() => {
    notify.current = { onContentsRead, onImported };
  });

  /**
   * 读列表分成「取数」与「落状态」两步。取数只回结果、不写 state，
   * 于是挂载 effect 里的 setState 全部落在 await 之后（同步级联会被
   * react-hooks/set-state-in-effect 拦下），重试与翻页又共用同一个落状态函数。
   *
   * stale：已有更新的一次读取在跑（或被卸载作废），迟到结果直接丢掉，
   * 否则旧响应会把新列表覆盖回去。
   */
  const requestContents = useCallback(
    async (nextPages: number): Promise<ContentsOutcome> => {
      reqRef.current += 1;
      const req = reqRef.current;
      try {
        const res = await fetch(`${CONTENTS_HREF}?pages=${nextPages}`, {
          cache: "no-store",
        });
        const payload = (await res.json().catch(() => null)) as
          | (Partial<ZhihuContentsResponse> & { error?: unknown })
          | null;
        if (req !== reqRef.current) return { kind: "stale" };

        // 401 是会话过期，与普通失败分开：给重新连接，而不是给重试。
        if (res.status === 401) return { kind: "unauthorized" };
        if (!res.ok) return { kind: "failed", message: readApiError(payload, res.status) };
        if (!payload || !Array.isArray(payload.items)) {
          return { kind: "failed", message: "创作列表接口返回了意外形状，请重试。" };
        }
        return {
          kind: "ok",
          items: payload.items,
          totals:
            typeof payload.totals === "number" ? payload.totals : payload.items.length,
          pages: nextPages,
        };
      } catch {
        if (req !== reqRef.current) return { kind: "stale" };
        // 网络断 / 非 JSON 响应：给文案 + 重试，不空屏。
        return {
          kind: "failed",
          message: "读取创作列表失败：网络中断或服务端未就绪。",
        };
      }
    },
    [],
  );

  const applyContents = useCallback((out: ContentsOutcome) => {
    switch (out.kind) {
      case "stale":
        return;
      case "unauthorized":
        setLoadError(null);
        setPhase("unauthorized");
        return;
      case "failed":
        setLoadError(out.message);
        setPhase("failed");
        return;
      case "ok":
        setItems(out.items);
        setTotals(out.totals);
        setPages(out.pages);
        // 服务端回的是累计去重后的全量列表，所以每次读取后默认全选；
        // 翻页只是把新读到的条目也纳入选择，不会把已选的挤掉。
        setSelected(new Set(out.items.map((item) => item.url)));
        setLoadError(null);
        setPhase("ready");
        // 会话里的创作数刚刚长大了，让上层把顶部计数拉新一次。
        notify.current.onContentsRead();
        return;
    }
  }, []);

  useEffect(() => {
    void requestContents(FIRST_PAGES).then(applyContents);
    return () => {
      // 卸载后在途结果作废（也顺带满足 StrictMode 双挂载）。
      reqRef.current += 1;
    };
  }, [applyContents, requestContents]);

  /** 重新读当前页。先转 loading 再取数——这一步在事件处理器里，同步 setState 没问题。 */
  const reloadContents = useCallback(
    (nextPages: number) => {
      setPhase("loading");
      void requestContents(nextPages).then(applyContents);
    },
    [applyContents, requestContents],
  );
  const retryLoad = useCallback(() => reloadContents(pages), [pages, reloadContents]);

  const toggleOne = useCallback((url: string) => {
    setResult(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = useCallback(() => {
    setResult(null);
    setSelected(
      allSelected ? new Set() : new Set(items.map((item) => item.url)),
    );
  }, [allSelected, items]);

  const handleImport = useCallback(async () => {
    const urls = [...selected];
    if (!urls.length || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch(CONTENTS_HREF, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const payload = (await res.json().catch(() => null)) as
        | (Partial<ZhihuImportResult> & { error?: unknown })
        | null;

      if (!res.ok) {
        // 400（选中的都不可用）与 401（会话过期）都走这里：保留错误文案，
        // 列表不空掉，用户还能改选择再试。
        if (res.status === 401) setPhase("unauthorized");
        setImportError(readApiError(payload, res.status));
        return;
      }

      setResult({
        imported: typeof payload?.imported === "number" ? payload.imported : 0,
        totalChars:
          typeof payload?.totalChars === "number" ? payload.totalChars : 0,
        skipped: Array.isArray(payload?.skipped) ? payload.skipped : [],
        missing: typeof payload?.missing === "number" ? payload.missing : 0,
      });
      // 导入会清掉服务端旧产物，上层需要重新读 status：
      // 已导入计数与「去编译 / 去空间」主 CTA 都跟着变。
      notify.current.onImported();
    } catch {
      setImportError("导入没走通：网络中断或服务端未就绪。");
    } finally {
      setImporting(false);
    }
  }, [importing, selected]);

  // 导入成功后收起列表，只留结果摘要；「重新选择」再展开（列表数据还在状态里）。
  const showList =
    !result && (phase === "loading" || phase === "ready") && items.length > 0;

  return (
    <section className="mt-3 rounded-xl border border-ink/10 bg-white p-4 text-left">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="eyebrow">Step 1 · 选择并导入创作</p>
        <span className="font-mono text-[10px] text-ink/35">
          只读标题与摘要 · 摘要留在服务端会话
        </span>
      </div>

      {/* 会话过期：读列表和导入都会 401，统一在这里收口成「重新连接」。 */}
      {phase === "unauthorized" && (
        <div className="mt-3 rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-[12px] leading-5 text-amber-800">
          知乎会话已过期，读不到你的创作列表。
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <a
              className="rounded-full bg-[#0084FF] px-4 py-1.5 text-[12px] font-bold text-white transition hover:bg-[#0070E0]"
              href={reconnectHref}
            >
              重新连接
            </a>
            <button
              className="rounded-full border border-amber-400/60 px-4 py-1.5 text-[12px] font-bold text-amber-900 transition hover:bg-amber-100"
              onClick={onRecheck}
              type="button"
            >
              重新检查状态
            </button>
          </span>
        </div>
      )}

      {/* 首帧读取；已有列表时不重复占位，避免翻页闪屏。 */}
      {phase === "loading" && items.length === 0 && (
        <p aria-busy="true" className="mt-3 cursor-wait text-[12px] text-ink/45">
          正在读取你的创作列表…
        </p>
      )}

      {phase === "failed" && (
        <div className="mt-3 rounded-xl border border-red-500/25 bg-red-50 p-3 text-[12px] leading-5 text-red-700">
          {loadError ?? "读取创作列表失败。"}
          <span className="mt-2 block">
            <button
              className="rounded-full border border-red-500/30 bg-white px-4 py-1.5 text-[12px] font-bold text-red-700 transition hover:border-red-500/60"
              onClick={retryLoad}
              type="button"
            >
              重试
            </button>
          </span>
        </div>
      )}

      {phase === "ready" && items.length === 0 && (
        <p className="mt-3 text-[12px] leading-5 text-ink/50">
          没有读到任何创作。知乎开放平台只返回已通过审核的公开文章，
          账号下还没有公开文章时这里就是空的。
          <button
            className="ml-2 rounded-full border border-ink/15 px-3 py-1 text-[11px] font-bold text-ink/60 transition hover:border-ink/30"
            onClick={retryLoad}
            type="button"
          >
            重新读取
          </button>
        </p>
      )}

      {importedCount > 0 && !result && (
        <p className="mt-2 text-[11px] leading-5 text-ink/40">
          已导入 {importedCount} 篇。重新导入会替换这一批，并让旧的编译产物失效。
        </p>
      )}

      {showList && (
        <>
          <p className="mt-2 text-[12px] text-ink/55">
            读到 <strong className="font-display text-base">{totals}</strong>{" "}
            篇创作{pages > FIRST_PAGES ? `（已翻 ${pages} 页）` : ""}
          </p>
          <ul
            aria-busy={phase === "loading"}
            className={`scrollbar mt-2 max-h-56 space-y-0.5 overflow-y-auto border-t border-ink/5 pt-2 transition ${
              phase === "loading" ? "opacity-55" : ""
            }`}
          >
            {items.map((item) => {
              const checked = selected.has(item.url);
              return (
                <li key={item.url}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] leading-5 transition hover:bg-[#F6F6F6]">
                    <input
                      checked={checked}
                      className="mt-0.5 size-3.5 shrink-0 accent-[#0084FF]"
                      onChange={() => toggleOne(item.url)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink/80">
                        {item.title || "（无标题）"}
                      </span>
                      <span className="block font-mono text-[10px] text-ink/35">
                        {item.publishedAt} · 摘要 {item.summaryChars} 字 · 赞{" "}
                        {item.likeCount}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button
              className="text-[11px] font-bold text-ink/45 underline-offset-2 transition hover:text-ink/70 hover:underline"
              onClick={toggleAll}
              type="button"
            >
              {allSelected ? "取消全选" : "全选"}（已选 {selected.size} /{" "}
              {items.length}）
            </button>
            {pages < MAX_CONTENTS_PAGES && phase !== "loading" && (
              <button
                className="rounded-full border border-ink/15 px-3 py-1 text-[11px] font-bold text-ink/60 transition hover:border-ink/30 hover:text-ink"
                onClick={() => reloadContents(pages + 1)}
                type="button"
              >
                再多读一页
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              className="rounded-full bg-[#0084FF] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#0070E0] disabled:cursor-wait disabled:opacity-55"
              disabled={selected.size === 0 || importing}
              onClick={() => void handleImport()}
              type="button"
            >
              {importing
                ? "导入中…"
                : selected.size === 0
                  ? "先勾选要导入的创作"
                  : `导入这 ${selected.size} 篇`}
            </button>
            <span className="text-[11px] text-ink/40">
              摘要过短的条目会被服务端跳过
            </span>
          </div>

          {importError && (
            <p
              aria-live="polite"
              className="mt-2 rounded-xl border border-red-500/25 bg-red-50 p-3 text-[12px] leading-5 text-red-700"
            >
              {importError}
            </p>
          )}
        </>
      )}

      {result && (
        <div
          aria-live="polite"
          className="mt-3 rounded-xl border border-emerald-300/50 bg-emerald-50 p-3"
        >
          <p className="text-sm font-bold text-emerald-800">
            已导入 {result.imported} 篇 · {formatChars(result.totalChars)}
          </p>
          {result.skipped.length > 0 && (
            <>
              <p className="mt-1.5 text-[11px] leading-5 text-emerald-900/70">
                跳过 {result.skipped.length} 篇：
              </p>
              <ul className="mt-0.5 space-y-0.5 text-[11px] leading-5 text-emerald-900/70">
                {result.skipped.slice(0, MAX_SKIPPED_SHOWN).map((entry) => (
                  <li className="truncate" key={entry.title + entry.reason}>
                    · {entry.title || "（无标题）"}——{entry.reason}
                  </li>
                ))}
                {result.skipped.length > MAX_SKIPPED_SHOWN && (
                  <li>
                    · …另有 {result.skipped.length - MAX_SKIPPED_SHOWN} 篇
                  </li>
                )}
              </ul>
            </>
          )}
          {result.missing > 0 && (
            <p className="mt-1.5 text-[11px] leading-5 text-emerald-900/70">
              另有 {result.missing} 条链接已不在当前列表里，未导入。
            </p>
          )}
          {result.imported === 0 && (
            <p className="mt-1.5 text-[11px] leading-5 text-emerald-900/70">
              这一批没有可用文本，换些创作再试一次。
            </p>
          )}
          <button
            className="mt-2 rounded-full border border-emerald-500/40 bg-white px-4 py-1.5 text-[12px] font-bold text-emerald-800 transition hover:border-emerald-600"
            onClick={() => setResult(null)}
            type="button"
          >
            重新选择
          </button>
        </div>
      )}
    </section>
  );
}
