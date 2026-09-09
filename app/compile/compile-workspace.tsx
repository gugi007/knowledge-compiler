"use client";

import Link from "next/link";
import { useCompile } from "@/app/_shared/hooks/use-compile";
import { PageShell } from "@/app/_shared/ui/page-shell";
import { ScaffoldNotice } from "@/app/_shared/ui/scaffold-notice";
import { StatGrid } from "@/app/_shared/ui/stat-grid";
import {
  PRODUCT_STAGE_COPY,
  PRODUCT_STAGES,
  STAGE_TO_PRODUCT,
} from "@/lib/frontend/compile-stream";
import { COMPILED_SOURCE_ID } from "@/lib/frontend/handoff";
import { ROUTES } from "@/lib/frontend/routes";
import { summarize } from "@/lib/frontend/dataset";

/**
 * 编译台骨架。
 *
 * OWNER: compiler-ui-agent
 *
 * 现在只验证一条链路是通的：useCompile → /api/compile 流 → 交接层 → 第三幕。
 * 四阶段列表用 PRODUCT_STAGES 渲染，产物统计用 summarize。
 * 迷你图谱、校对三区、跳过/重试都还没做。
 *
 * 契约边界：不要在这里直接 fetch /api/compile，也不要自己写 sessionStorage。
 * 前者用 useCompile，后者由 useCompile 内部经 handoff.ts 完成。
 */
export function CompileWorkspace() {
  const compile = useCompile();
  const activeProduct = compile.stage ? STAGE_TO_PRODUCT[compile.stage] : undefined;
  const summary = compile.dataset ? summarize(compile.dataset) : undefined;

  return (
    <PageShell eyebrow="Act 2 · 编译台">
      <section className="panel mt-6 p-5 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Compiler</p>
            <h1 className="mt-1 font-display text-2xl font-semibold">编译你的创作史</h1>
          </div>
          <button
            className="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#004bbb] disabled:cursor-wait disabled:opacity-55"
            disabled={compile.status === "running"}
            onClick={() => void compile.start()}
            type="button"
          >
            {compile.status === "running" ? "编译中…" : "开始编译"}
          </button>
        </div>

        {/* 进度条：按阶段权重估算，不是精确进度，文案里要说清。 */}
        <div className="mt-6">
          <div className="h-1 overflow-hidden rounded-full bg-ink/8">
            <div
              className="h-full rounded-full bg-coral transition-[width] duration-500"
              style={{ width: `${Math.round(compile.progress * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-ink/35">
            {Math.round(compile.progress * 100)}% · 按阶段估算
          </p>
        </div>

        {/* 产品四阶段。编译器内部是五个，由 STAGE_TO_PRODUCT 投影过来。 */}
        <ol aria-live="polite" className="mt-5 grid gap-2">
          {PRODUCT_STAGES.map((productStage, index) => {
            const active = activeProduct === productStage;
            const done =
              compile.status === "done" ||
              (activeProduct !== undefined &&
                PRODUCT_STAGES.indexOf(activeProduct) > index);
            const copy = PRODUCT_STAGE_COPY[productStage];
            return (
              <li
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
                  active ? "bg-lime/55 font-bold" : "bg-white text-ink/60"
                }`}
                key={productStage}
              >
                <span
                  className={`grid size-6 flex-none place-items-center rounded-full font-mono text-[10px] font-bold ${
                    done
                      ? "bg-ink text-paper"
                      : active
                        ? "bg-coral text-white"
                        : "border border-ink/15"
                  }`}
                >
                  {done ? "✓" : index + 1}
                </span>
                {done ? copy.done : copy.active}
              </li>
            );
          })}
        </ol>

        {compile.error && (
          <p className="mt-5 rounded-xl border border-red-500/25 bg-red-50 p-3 text-sm leading-6 text-red-700">
            {compile.error}
          </p>
        )}

        {summary && (
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
            <Link
              className="mt-5 block rounded-full bg-coral px-5 py-3 text-center text-sm font-bold text-white transition hover:bg-[#004bbb]"
              href={`${ROUTES.space}?source=${COMPILED_SOURCE_ID}`}
            >
              进入我的知识空间 →
            </Link>
          </div>
        )}
      </section>

      <ScaffoldNotice
        owner="compiler-ui-agent"
        todo={[
          "作者信息卡（头像 / 正在编译谁 / 领域 / 创作数）",
          "迷你图谱预览：星体逐个出现（需 CCR：当前流没有增量节点事件）",
          "阶段实时数字（篇数 / 概念数 / 关系数，同上需 CCR）",
          "校对视图三区：概念校对、关系校对、观点标记",
          "跳过 / 重试 / 错误兜底",
          "增量编译（只跑读取 + 挂载两阶段）",
          "响应式：窄屏阶段列表与迷你图谱上下堆叠",
        ]}
      />
    </PageShell>
  );
}
