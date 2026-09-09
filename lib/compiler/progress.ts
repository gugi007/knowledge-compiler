import type { RelationKind } from "@/data/models";

/**
 * 编译过程的可观测契约。compileKnowledge 实时发这些事件，replayCompileEvents
 * 从已落盘的产物反推同一形状的事件序列——编译台因此可以用同一套渲染逻辑
 * 既跑真编译也跑回放。
 *
 * CompileStage 定义在这里而不是 compile.ts，是为了让本模块不反向依赖 compile.ts：
 * compile.ts 要在运行时 import computeProgress，两边互相引会形成循环依赖。
 * compile.ts 会 re-export 这个类型，所以既有的导入路径不变。
 */

export type CompileStage =
  | "parsing-articles"
  | "extracting-concepts"
  | "resolving-concepts"
  | "synthesizing-relations"
  | "building-reading-paths";

export interface StageCounts {
  articlesTotal: number;
  articlesDone: number;
  /** 各篇抽取出的原始候选概念数，归一化合并之前。 */
  conceptCandidates: number;
  /** 归一化之后的概念数。 */
  concepts: number;
  /**
   * 穷举出的跨文章共现候选对数。当前分支的管线没有这个信号，恒为 0；
   * 字段先留在契约里，等真实来源接入后填上。
   */
  coMentionCandidates: number;
  /** 概念间关系数，不含 article-concept。 */
  conceptRelations: number;
  /** article-concept 关系数。 */
  articleConceptRelations: number;
}

export const EMPTY_STAGE_COUNTS: StageCounts = {
  articlesTotal: 0,
  articlesDone: 0,
  conceptCandidates: 0,
  concepts: 0,
  coMentionCandidates: 0,
  conceptRelations: 0,
  articleConceptRelations: 0,
};

/** 迷你图谱用的瘦身投影。不带 summary、不带 evidence quote——那是产物体积的大头。 */
export interface ProvisionalNode {
  slug: string;
  name: string;
  domain: string;
  level: "foundation" | "intermediate" | "advanced";
  articleId: string;
}

export interface ConceptNode {
  id: string;
  name: string;
  domain: string;
  level: "foundation" | "intermediate" | "advanced";
  confidence: number;
  evidenceArticleIds: string[];
}

export interface RelationEdge {
  id: string;
  kind: RelationKind;
  sourceId: string;
  targetId: string;
  confidence: number;
}

/**
 * stage 在每个阶段开始前发一次（与旧契约同位置，但带上 counts）；
 * tick 发增量（只带新出现的节点，几百字节）；
 * snapshot 在阶段末发一次该阶段的完整集合，客户端直接替换。
 *
 * tick / snapshot 目前是纯类型契约：compileKnowledge 只发 stage。
 * 接入真实增量信号前，客户端不得依赖它们会出现。
 */
export type CompileProgressEvent =
  | { type: "stage"; stage: CompileStage; counts: StageCounts; progress: number }
  | { type: "tick"; stage: CompileStage; counts: StageCounts; progress: number; nodes?: ProvisionalNode[] }
  | { type: "snapshot"; stage: CompileStage; counts: StageCounts; progress: number; nodes?: ConceptNode[]; edges?: RelationEdge[] };

export type CompileProgressHandler = (event: CompileProgressEvent) => void | Promise<void>;

/**
 * 阶段权重表。只有抽取阶段有确定的分母（恰好一篇文章一次 provider.extract），
 * 其余阶段按固定权重计。UI 必须标注这是「按阶段权重估算」，不能当成精确进度。
 */
export const STAGE_WEIGHTS: Record<CompileStage, number> = {
  "parsing-articles": 0.05,
  "extracting-concepts": 0.7,
  "resolving-concepts": 0.1,
  "synthesizing-relations": 0.1,
  "building-reading-paths": 0.05,
};

export const STAGE_ORDER: CompileStage[] = [
  "parsing-articles",
  "extracting-concepts",
  "resolving-concepts",
  "synthesizing-relations",
  "building-reading-paths",
];

export function computeProgress(stage: CompileStage, counts: StageCounts): number {
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0) return 0;
  let done = 0;
  for (let i = 0; i < index; i += 1) done += STAGE_WEIGHTS[STAGE_ORDER[i]!];
  const weight = STAGE_WEIGHTS[stage]!;
  // 抽取阶段按已完成篇数细分；其余阶段进行中一律算 half，完成后由下一个 stage 事件推进。
  const within = stage === "extracting-concepts" && counts.articlesTotal > 0
    ? counts.articlesDone / counts.articlesTotal
    : 0.5;
  return Math.min(1, Math.round((done + weight * within) * 100) / 100);
}
