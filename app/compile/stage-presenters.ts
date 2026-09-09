import type { Concept } from "@/data/models";
import type { ProductStage, StageCounts } from "@/lib/frontend/compile-stream";

/**
 * 编译台本幕的领域配色（星区底色）。
 *
 * 只用于本目录下的迷你星图与领域标签。第三幕真正的图谱画布在
 * app/space/graph/** 里有自己的配色实现（domain-colors.ts），
 * 两边不同步不构成契约漂移——画布配色不是共享契约。
 */

export interface DomainTone {
  /** 节点填充 / 图例圆点。 */
  solid: string;
  /** 星区铺底。 */
  soft: string;
}

const TONES: readonly DomainTone[] = [
  { solid: "#0066ff", soft: "rgba(0, 102, 255, 0.10)" },
  { solid: "#7c6cff", soft: "rgba(124, 108, 255, 0.12)" },
  { solid: "#12a182", soft: "rgba(18, 161, 130, 0.12)" },
  { solid: "#e8890c", soft: "rgba(232, 137, 12, 0.12)" },
  { solid: "#d4477c", soft: "rgba(212, 71, 124, 0.12)" },
  { solid: "#5b6b7f", soft: "rgba(91, 107, 127, 0.12)" },
];

export function domainTone(domain: string): DomainTone {
  let hash = 0;
  for (const char of domain) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return TONES[hash % TONES.length]!;
}

/** 迷你星图的一个节点。坐标与半径都是 0..1 的归一化值，由 viewBox 放大。 */
export interface MiniStar {
  id: string;
  name: string;
  domain: string;
  level: Concept["level"];
  x: number;
  y: number;
  r: number;
}

const LEVEL_BASE_R: Record<Concept["level"], number> = {
  foundation: 0.030,
  intermediate: 0.024,
  advanced: 0.019,
};

/**
 * 概念 → 确定性星位。布局不进 lib/frontend/graph.ts 契约（那条契约只约束第三幕
 * 画布的 props，且明确坐标由画布内部算），这里的投影只服务本幕装饰性预览。
 *
 * x 由概念 id 哈希决定（确定性，同一产物两次编译星位一致）；
 * y 按 level 分带：基础沉底、高级浮顶，呼应「进阶向上」的隐喻；
 * 半径 = level 基础值 + 证据文章数加成（clamp 上限）。
 */
export function toMiniStar(concept: Concept): MiniStar {
  let hash = 0;
  for (const char of concept.id) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  const x = 0.08 + (hash % 840) / 1000; // 0.08..0.92
  const band =
    concept.level === "foundation" ? 0.72
    : concept.level === "intermediate" ? 0.47
    : 0.22;
  const y = band + (((hash >>> 8) % 160) - 80) / 1000;
  const r = Math.min(
    0.05,
    LEVEL_BASE_R[concept.level] + concept.evidenceArticleIds.length * 0.003,
  );
  return { id: concept.id, name: concept.name, domain: concept.domain, level: concept.level, x, y, r };
}

/** 各产品阶段的实时计数行（取自事件 counts；completedStages 不够细，不走这里）。 */
export function stageLiveCount(
  stage: ProductStage,
  counts: StageCounts,
): string | undefined {
  switch (stage) {
    case "reading":
      if (counts.articlesTotal <= 0) return undefined;
      return `${counts.articlesDone} / ${counts.articlesTotal} 篇`;
    case "concepts":
      if (counts.concepts <= 0 && counts.conceptCandidates <= 0) return undefined;
      return `已识别 ${counts.concepts} 个概念`;
    case "relations":
      if (counts.conceptRelations <= 0) return undefined;
      return `已建立 ${counts.conceptRelations} 条关系`;
    case "graph":
      return undefined;
  }
}

/** 完成态的回顾计数行（此时事件 counts 已由产物精确回填，candidates 恒 0）。 */
export function stageDoneCount(
  stage: ProductStage,
  counts: StageCounts,
): string | undefined {
  switch (stage) {
    case "reading":
      return counts.articlesTotal > 0 ? `${counts.articlesTotal} 篇创作` : undefined;
    case "concepts":
      return counts.concepts > 0 ? `${counts.concepts} 个概念` : undefined;
    case "relations":
      return counts.conceptRelations > 0
        ? `${counts.conceptRelations} 条概念关系`
        : undefined;
    case "graph":
      return undefined;
  }
}

/** 概念候选 → 归一化概念的收敛比，进度条下的注记。 */
export function convergenceNote(counts: StageCounts): string | undefined {
  if (counts.conceptCandidates <= 0 || counts.concepts <= 0) return undefined;
  if (counts.conceptCandidates <= counts.concepts) return undefined;
  return `候选 ${counts.conceptCandidates} → 概念 ${counts.concepts}`;
}
