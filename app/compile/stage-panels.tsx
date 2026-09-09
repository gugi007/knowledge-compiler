"use client";

import { useEffect, useState } from "react";
import type { CompiledKnowledgeDataset } from "@/data/models";
import {
  PRODUCT_STAGE_COPY,
  PRODUCT_STAGES,
  type ProductStage,
  type StageCounts,
} from "@/lib/frontend/compile-stream";
import {
  domainTone,
  stageDoneCount,
  stageLiveCount,
  toMiniStar,
  type MiniStar,
} from "./stage-presenters";

/**
 * 四产品阶段清单：进行态 + 回顾态共用。
 *
 * - active：当前推进到的阶段；done：编译完成，或产品阶段序已越过它。
 *   「越过」用产品阶段序比较，而不是 useCompile 的 completedStages——后者是
 *   内部五阶段的粒度，两个内部阶段映射到同一产品阶段时标号会闪变。
 * - 计数行：进行中取事件 counts（stageLiveCount）；完成后由 useCompile 在
 *   complete 时用产物精确回填（candidates 属过程量不可回推、恒 0），
 *   所以完成态走 stageDoneCount，不展示中间过程量。
 * - 失败：阶段定格在出错位置不推进，原因由上方错误横幅说明。
 */

interface StageListProps {
  status: "idle" | "running" | "done" | "error";
  productStage?: ProductStage;
  counts: StageCounts;
}

export function StageList({ status, productStage, counts }: StageListProps) {
  const finished = status === "done";
  const activeIndex = productStage ? PRODUCT_STAGES.indexOf(productStage) : -1;

  return (
    <ol aria-live="polite" className="mt-5 grid gap-2">
      {PRODUCT_STAGES.map((stage, index) => {
        const active = stage === productStage && status === "running";
        const done = finished || (activeIndex >= 0 && index < activeIndex);
        const copy = PRODUCT_STAGE_COPY[stage];
        const tally = finished || done
          ? stageDoneCount(stage, counts)
          : active
            ? stageLiveCount(stage, counts)
            : undefined;
        return (
          <li
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
              active
                ? "bg-lime/55 font-bold"
                : done
                  ? "bg-white text-ink/80"
                  : "bg-white text-ink/45"
            }`}
            key={stage}
          >
            <StageBadge active={active} done={done} index={index} />
            <span className="min-w-0 flex-1 truncate">
              {done ? copy.done : copy.active}
            </span>
            {tally && (
              <span className="flex-none font-mono text-[10px] text-ink/40">{tally}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StageBadge({ active, done, index }: { active: boolean; done: boolean; index: number }) {
  const base =
    "grid size-6 flex-none place-items-center rounded-full font-mono text-[10px] font-bold";
  if (done) {
    return (
      <span aria-hidden className={`${base} bg-ink text-paper`}>
        ✓
      </span>
    );
  }
  if (active) {
    return (
      <span aria-hidden className={`${base} bg-coral text-white`}>
        {/* 进行中的脉冲点；prefers-reduced-motion 下动画被全局关掉，退化为静态点。 */}
        <span className="size-1.5 animate-pulse rounded-full bg-white" />
      </span>
    );
  }
  return (
    <span aria-hidden className={`${base} border border-ink/15 text-ink/45`}>
      {index + 1}
    </span>
  );
}

/**
 * 完成态的迷你星图预览：概念按 level 分带、domain 着色的静态散布。
 *
 * 契约边界：流事件目前没有 tick/snapshot 增量节点（lib/frontend/compile-stream.ts
 * 注明「接入前不得依赖」，架构文档记为缺口 C1），所以「星体逐个出现」做不了——
 * 这里是 complete 后的一次性全量呈现，入场动画只是错峰淡入，不暗示编译时序。
 */
export function MiniStarMap({ dataset }: { dataset: CompiledKnowledgeDataset }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const stars = dataset.concepts.map((concept) => toMiniStar(concept));
  const domains = [...new Set(dataset.concepts.map(({ domain }) => domain))];

  return (
    <figure className="mt-6">
      <svg
        aria-label={`概念星图预览，共 ${stars.length} 个概念`}
        className="block w-full rounded-xl border border-ink/10 bg-[#0b1020]"
        role="img"
        viewBox="0 0 100 62"
      >
        {stars.map((star) => (
          <StarDot key={star.id} shown={shown} star={star} />
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {domains.map((domain) => (
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[10px] text-ink/50"
            key={domain}
          >
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: domainTone(domain).solid }}
            />
            {domain}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function StarDot({ shown, star }: { shown: boolean; star: MiniStar }) {
  const tone = domainTone(star.domain);
  return (
    <g style={{ opacity: shown ? 1 : 0, transition: "opacity 600ms ease" }}>
      <title>{star.name}</title>
      <circle
        cx={star.x * 100}
        cy={star.y * 62}
        fill={tone.solid}
        fillOpacity={0.9}
        r={star.r * 62}
      />
    </g>
  );
}
