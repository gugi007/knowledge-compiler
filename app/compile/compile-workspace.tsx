"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useCompile } from "@/app/_shared/hooks/use-compile";
import type { CorpusId } from "@/lib/frontend/corpora";
import { PageShell } from "@/app/_shared/ui/page-shell";
import { StatGrid } from "@/app/_shared/ui/stat-grid";
import { summarize } from "@/lib/frontend/dataset";
import { COMPILED_SOURCE_ID } from "@/lib/frontend/handoff";
import { ROUTES } from "@/lib/frontend/routes";
import { ReviewPanel } from "./review-panel";
import { MiniStarMap, StageList } from "./stage-panels";
import { convergenceNote } from "./stage-presenters";

// 读取 ?corpus= 的客户端快照。沿用 use-active-dataset 的做法：不用 useSearchParams
// （静态渲染要求外层套 Suspense），改用 useSyncExternalStore + window.location。
const noopSubscribe = () => () => {};
const serverSnapshot = () => null;
function corpusSnapshot(): string {
  return new URLSearchParams(window.location.search).get("corpus") ?? "";
}

/**
 * 第二幕：编译台。
 *
 * OWNER: compiler-ui-agent（本目录下所有内容）
 *
 * 流程：开始编译 → 四产品阶段可见推进（内部五阶段由 STAGE_TO_PRODUCT 投影，
 * 不改编译器）→ 完成后进入校对视图（概念 / 关系 / 阅读路径三区）→ 进知识空间。
 *
 * 契约边界：
 * - 流式读取、阶段推进、sessionStorage 交接都在共享的 useCompile 里，
 *   这里不直接 fetch /api/compile，也不自己写 sessionStorage。
 * - 进度是按阶段权重的估算（STAGE_WEIGHTS），UI 如实标注，不伪装成精确百分比。
 */
export function CompileWorkspace() {
  // URL 上的 ?corpus= 收窄成 CorpusId；非法或缺省 → undefined → useCompile 退回 "demo"。
  const corpusParam = useSyncExternalStore(noopSubscribe, corpusSnapshot, serverSnapshot);
  const corpus: CorpusId | undefined =
    corpusParam === "demo" || corpusParam === "sujianlin" || corpusParam === "imported"
      ? corpusParam
      : undefined;
  const compile = useCompile({ corpus, mode: "compile" });
  const running = compile.status === "running";
  const summary = compile.dataset ? summarize(compile.dataset) : undefined;
  const note = convergenceNote(compile.counts);

  return (
    <PageShell eyebrow="Act 2 · 编译台">
      <section className="panel mt-6 p-5 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Compiler</p>
            <h1 className="mt-1 font-display text-2xl font-semibold">编译你的创作史</h1>
            <p className="mt-1 text-sm text-ink/55">
              {compile.status === "done"
                ? "编译完成，下面是这次产物的校对视图。"
                : "把按时间散落的文章，编译成一张可探索的知识网络。"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(compile.status === "done" || compile.status === "error") && (
              <button
                className="rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-bold text-ink/60 transition hover:border-ink/30 hover:text-ink/80"
                onClick={compile.reset}
                type="button"
              >
                {compile.status === "done" ? "重新来过" : "清除错误"}
              </button>
            )}
            <button
              className="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#004bbb] disabled:cursor-wait disabled:opacity-55"
              disabled={running}
              onClick={() => void compile.start()}
              type="button"
            >
              {running
                ? "编译中…"
                : compile.status === "done"
                  ? "再编译一次"
                  : "开始编译"}
            </button>
          </div>
        </div>

        {/* 进度条：按阶段权重估算（extracting 占 0.7），不是精确进度，文案如实标注。 */}
        <div className="mt-6">
          <div
            aria-label={`编译进度约 ${Math.round(compile.progress * 100)}%（估算）`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(compile.progress * 100)}
            className="h-1 overflow-hidden rounded-full bg-ink/8"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-coral transition-[width] duration-500"
              style={{ width: `${Math.round(compile.progress * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 font-mono text-[10px] text-ink/35">
            <span>
              {Math.round(compile.progress * 100)}% · 按阶段权重估算，非精确进度
            </span>
            {note && <span>{note}</span>}
          </p>
        </div>

        {/* 产品四阶段。编译器内部是五个，由 STAGE_TO_PRODUCT 投影过来，实时计数走 counts。 */}
        <StageList
          counts={compile.counts}
          productStage={compile.productStage}
          status={compile.status}
        />

        {compile.status === "idle" && (
          <p className="mt-5 rounded-xl border border-ink/10 bg-paper p-3 text-[12px] leading-5 text-ink/50">
            当前演示编的是仓库内置示例语料。编译过程会分四步可见推进，
            完成后先在这里校对概念与关系，再进入知识空间。
          </p>
        )}

        {compile.error && (
          <div className="mt-5 rounded-xl border border-red-500/25 bg-red-50 p-3">
            <p className="text-sm leading-6 text-red-700">{compile.error}</p>
            <p className="mt-1 text-[11px] leading-5 text-red-600/70">
              上一次成功的产物不受影响；知识空间仍可打开。
            </p>
            <button
              className="mt-2 rounded-full border border-red-500/30 bg-white px-4 py-1.5 text-[12px] font-bold text-red-700 transition hover:border-red-500/60"
              onClick={() => void compile.start()}
              type="button"
            >
              重试编译
            </button>
          </div>
        )}

        {summary && compile.dataset && (
          <div className="mt-6 border-t border-ink/10 pt-6">
            <StatGrid
              items={[
                { label: "Articles", value: summary.articles },
                { label: "Concepts", value: summary.concepts },
                { label: "Relations", value: summary.conceptRelations },
                { label: "Paths", value: summary.readingPaths },
              ]}
            />
            <p className="mt-4 text-center font-mono text-[11px] text-ink/45">
              {summary.provider} · {summary.mode}
            </p>

            {/* 迷你星图：完成态一次性全量呈现（流无增量节点事件，缺口 C1）。 */}
            <MiniStarMap dataset={compile.dataset} />
          </div>
        )}
      </section>

      {/* 校对视图：概念 / 关系 / 阅读路径三区，只读审查。 */}
      {compile.dataset && <ReviewPanel dataset={compile.dataset} />}

      {compile.status === "done" && (
        <Link
          className="mt-4 block rounded-full bg-coral px-5 py-3.5 text-center text-sm font-bold text-white transition hover:bg-[#004bbb]"
          href={`${ROUTES.space}?source=${COMPILED_SOURCE_ID}`}
        >
          校对无误，进入我的知识空间 →
        </Link>
      )}

      {compile.status !== "done" && (
        <p className="mt-4 text-center font-mono text-[10px] leading-5 text-ink/35">
          增量编译（只跑读取 + 挂载两阶段）尚未接入 ·
          阶段实时数字依赖服务端 counts 事件，缺增量 tick 时部分数字只在阶段末更新
        </p>
      )}
    </PageShell>
  );
}
