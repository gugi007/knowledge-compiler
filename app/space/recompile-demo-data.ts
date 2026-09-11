"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompiledKnowledgeDataset } from "@/data/models";
import { articlesByDate } from "@/lib/frontend/dataset";

/**
 * 第三幕「二次编译演示」的纯前端状态机（批次 4/5）。
 *
 * 这一段**不产生任何真实编译产物**：不 fetch `/api/compile`，不碰
 * `lib/frontend/handoff.ts`，只把「增量重编译」这件事在客户端演一遍。
 * 新增/改写/新边的 id 全部从传入的 dataset 里真实挑出来，保证画布上
 * 高亮的都是真实存在的节点与边。
 *
 * 编排（照参考稿的四步，时长与百分比一一对应）：
 *
 * | 步 | 名称 | 时长 | 累计 pct |
 * |----|------|------|---------|
 * | 0 | 读取新文章 | 1150ms | 22 |
 * | 1 | 概念抽取 | 1750ms | 52 |
 * | 2 | 关系构建 | 1400ms | 80 |
 * | 3 | 图谱生成 | 1150ms | 100 |
 */

export type RecompilePhase = "idle" | "running" | "done";

export interface RecompileCounts {
  articles: number;
  concepts: number;
  relations: number;
}

export interface RecompileStep {
  label: string;
  duration: number;
  pct: number;
}

export interface RecompileDemoState {
  phase: RecompilePhase;
  /** 当前第几步（0..3）。 */
  stepIndex: number;
  /** 0..100。 */
  pct: number;
  /** 本次「新增」的规模，跑的过程中递增到目标值。 */
  counts: RecompileCounts;
  /** 本次「新增」的节点 id（取自 dataset 的真实概念 id）。 */
  newNodeIds: string[];
  /** 本次「改写」的节点 id（取自 dataset 的真实概念 id）。 */
  updatedNodeIds: string[];
  /** 本次「新增」的边 id（取自 dataset 的真实概念间关系 id）。 */
  newEdgeIds: string[];
  /** 产物覆盖的时间范围，形如 "2024.03→2024.09"。 */
  rangeLabel: string;
  start: () => void;
}

export interface UseRecompileDemoOptions {
  dataset: CompiledKnowledgeDataset;
  /** false 时整个 hook 惰性：不起计时器，对外始终是 idle。 */
  enabled: boolean;
}

/** 参考稿的四步文案与节奏。 */
export const RECOMPILE_STEPS: readonly RecompileStep[] = [
  { label: "读取新文章", duration: 1150, pct: 22 },
  { label: "概念抽取", duration: 1750, pct: 52 },
  { label: "关系构建", duration: 1400, pct: 80 },
  { label: "图谱生成", duration: 1150, pct: 100 },
];

/** localStorage 基线 key（固定，跨语料只存一份）。 */
export const BASELINE_KEY = "kc:baseline";

/** 计时器步长：50ms 足够让 CSS 的 500ms width transition 跟上。 */
const TICK_MS = 50;
/** 没有基线差集时（首次访问）的演示兜底：把最新的 N 篇当成「本次新文章」。 */
const FALLBACK_NEW_ARTICLES = 3;
const MAX_NEW_NODES = 4;
const MAX_UPDATED_NODES = 3;
const MAX_NEW_EDGES = 3;

const STEP_0_END = RECOMPILE_STEPS[0].duration;
const STEP_1_END = STEP_0_END + RECOMPILE_STEPS[1].duration;
const STEP_2_END = STEP_1_END + RECOMPILE_STEPS[2].duration;
const STEP_3_END = STEP_2_END + RECOMPILE_STEPS[3].duration;
const TOTAL_DURATION = STEP_3_END;
const LAST_STEP_INDEX = RECOMPILE_STEPS.length - 1;

// ---------------------------------------------------------------- 基线持久化

export interface Baseline {
  articles: string[];
  concepts: string[];
  relations: string[];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** 读基线。无 localStorage / 脏数据一律当「没有基线」。 */
export function readBaseline(): Baseline | undefined {
  try {
    const raw = window.localStorage.getItem(BASELINE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      articles: stringArray(parsed.articles),
      concepts: stringArray(parsed.concepts),
      relations: stringArray(parsed.relations),
    };
  } catch {
    // 隐私模式 / 存储被禁用 / JSON 损坏 → 降级为「无基线」，不抛。
    return undefined;
  }
}

/** 落基线。写不进去（无 localStorage）就静默降级为不持久化。 */
export function writeBaseline(dataset: CompiledKnowledgeDataset): void {
  try {
    const snapshot: Baseline = {
      articles: dataset.articles.map(({ id }) => id),
      concepts: dataset.concepts.map(({ id }) => id),
      relations: dataset.relations.map(({ id }) => id),
    };
    window.localStorage.setItem(BASELINE_KEY, JSON.stringify(snapshot));
  } catch {
    // 同上：无 localStorage 时本次演示照跑，只是不落盘。
  }
}

// ------------------------------------------------------------------ 内容挑选

export interface RecompileSelection {
  newArticleIds: string[];
  /** 本轮「新增」的概念 id（真实取自 dataset）。 */
  newNodeIds: string[];
  /** 本轮「改写」的概念 id（真实取自 dataset）。 */
  updatedNodeIds: string[];
  /** 本轮「新增」的边 id（真实取自 dataset 的概念间关系）。 */
  newEdgeIds: string[];
}

const EMPTY_SELECTION: RecompileSelection = {
  newArticleIds: [],
  newNodeIds: [],
  updatedNodeIds: [],
  newEdgeIds: [],
};

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 从 dataset 里挑出本轮演示要用的「新文章 / 新概念 / 改写概念 / 新边」。
 *
 * 优先级都是「相对基线的真实差集 → 由新文章推导 → 规模兜底」，任何一步
 * 拿到的都是 dataset 里真实存在的 id，绝不编造。
 */
export function buildRecompileSelection(
  dataset: CompiledKnowledgeDataset,
  baseline: Baseline | undefined,
): RecompileSelection {
  const knownArticles = new Set(baseline?.articles ?? []);
  const knownConcepts = new Set(baseline?.concepts ?? []);
  const knownRelations = new Set(baseline?.relations ?? []);

  // ---- 新文章：基线快照之后出现的；没有差集时取最新 N 篇 ----
  const newestFirst = [...articlesByDate(dataset)].reverse();
  const deltaArticles = newestFirst.filter((article) => !knownArticles.has(article.id));
  const freshArticles = deltaArticles.length
    ? deltaArticles
    : newestFirst.slice(0, FALLBACK_NEW_ARTICLES);
  const newArticleIds = freshArticles.map(({ id }) => id);
  const freshArticleSet = new Set(newArticleIds);

  // ---- 新概念：基线差集优先，其次「被新文章讨论过」的概念 ----
  const conceptIds = new Set(dataset.concepts.map(({ id }) => id));
  const deltaConcepts = dataset.concepts
    .filter((concept) => !knownConcepts.has(concept.id))
    .map(({ id }) => id);
  const discussedByFresh = dataset.concepts
    .filter((concept) => concept.evidenceArticleIds.some((id) => freshArticleSet.has(id)))
    .map(({ id }) => id);
  const newNodeIds = uniqueIds([...deltaConcepts, ...discussedByFresh]).slice(0, MAX_NEW_NODES);
  const newSet = new Set(newNodeIds);

  // ---- 改写概念：老概念被新文章再次讨论 → 与新节点相邻 → 证据最多 ----
  const rewritten = dataset.concepts
    .filter((concept) => !newSet.has(concept.id))
    .filter((concept) => concept.evidenceArticleIds.some((id) => freshArticleSet.has(id)))
    .map(({ id }) => id);
  const adjacent: string[] = [];
  for (const relation of dataset.relations) {
    if (relation.kind === "article-concept") continue;
    if (newSet.has(relation.sourceId) && !newSet.has(relation.targetId)) {
      adjacent.push(relation.targetId);
    } else if (newSet.has(relation.targetId) && !newSet.has(relation.sourceId)) {
      adjacent.push(relation.sourceId);
    }
  }
  const byEvidence = [...dataset.concepts]
    .filter((concept) => !newSet.has(concept.id))
    .sort(
      (a, b) =>
        b.evidenceArticleIds.length - a.evidenceArticleIds.length || a.id.localeCompare(b.id),
    )
    .map(({ id }) => id);
  const updatedNodeIds = uniqueIds([
    ...rewritten,
    ...adjacent.filter((id) => conceptIds.has(id)),
    ...byEvidence,
  ]).slice(0, MAX_UPDATED_NODES);

  // ---- 新边：只取概念间关系（article-concept 不进图谱，画不出来）----
  const touched = new Set([...newNodeIds, ...updatedNodeIds]);
  const conceptEdges = dataset.relations.filter(
    (relation) =>
      relation.kind !== "article-concept" &&
      conceptIds.has(relation.sourceId) &&
      conceptIds.has(relation.targetId),
  );
  const deltaEdges = conceptEdges
    .filter((relation) => !knownRelations.has(relation.id))
    .map(({ id }) => id);
  const touchedEdges = conceptEdges
    .filter((relation) => touched.has(relation.sourceId) || touched.has(relation.targetId))
    .map(({ id }) => id);
  const newEdgeIds = uniqueIds([...deltaEdges, ...touchedEdges]).slice(0, MAX_NEW_EDGES);

  return { newArticleIds, newNodeIds, updatedNodeIds, newEdgeIds };
}

/** 文章日期范围 → "YYYY.MM→YYYY.MM"（最早 → 最晚）。 */
export function rangeLabelOf(dataset: CompiledKnowledgeDataset): string {
  const months = dataset.articles
    .map(({ publishedAt }) => publishedAt)
    .filter((value) => /^\d{4}-\d{2}/.test(value))
    .sort();
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return "—";
  return `${first.slice(0, 7).replace("-", ".")}→${last.slice(0, 7).replace("-", ".")}`;
}

// ------------------------------------------------------------------ 进度推演

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** 时间 → （当前步，累计百分比）。 */
export function progressAt(elapsed: number): { stepIndex: number; pct: number } {
  if (elapsed >= TOTAL_DURATION) return { stepIndex: LAST_STEP_INDEX, pct: 100 };
  let acc = 0;
  let prevPct = 0;
  for (let index = 0; index < RECOMPILE_STEPS.length; index += 1) {
    const step = RECOMPILE_STEPS[index];
    const end = acc + step.duration;
    if (elapsed < end) {
      const ratio = step.duration > 0 ? clamp01((elapsed - acc) / step.duration) : 1;
      return { stepIndex: index, pct: Math.round(prevPct + (step.pct - prevPct) * ratio) };
    }
    acc = end;
    prevPct = step.pct;
  }
  return { stepIndex: LAST_STEP_INDEX, pct: 100 };
}

/** 某段区间内从 0 递增到 target（不要在阶段开始时瞬间跳满）。 */
function ramp(elapsed: number, from: number, to: number, target: number): number {
  if (to <= from) return target;
  return Math.round(target * clamp01((elapsed - from) / (to - from)));
}

/** 计数跟着三条产物线各自走完自己的阶段：文章→步0，概念→步1，关系→步2。 */
export function countsAt(elapsed: number, selection: RecompileSelection): RecompileCounts {
  return {
    articles: ramp(elapsed, 0, STEP_0_END, selection.newArticleIds.length),
    concepts: ramp(elapsed, STEP_0_END, STEP_1_END, selection.newNodeIds.length),
    relations: ramp(elapsed, STEP_1_END, STEP_2_END, selection.newEdgeIds.length),
  };
}

// ----------------------------------------------------------------------- hook

const IDLE_COUNTS: RecompileCounts = { articles: 0, concepts: 0, relations: 0 };
const NO_IDS: string[] = [];
const NOOP = () => {};

export function useRecompileDemo({
  dataset,
  enabled,
}: UseRecompileDemoOptions): RecompileDemoState {
  const [phase, setPhase] = useState<RecompilePhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [selection, setSelection] = useState<RecompileSelection>(EMPTY_SELECTION);

  const rangeLabel = useMemo(() => rangeLabelOf(dataset), [dataset]);

  // 首次访问落基线：只写不 setState，所以不触发 react-hooks/set-state-in-effect。
  useEffect(() => {
    if (!enabled) return;
    if (readBaseline()) return;
    writeBaseline(dataset);
  }, [enabled, dataset]);

  const start = useCallback(() => {
    if (!enabled) return;
    setSelection(buildRecompileSelection(dataset, readBaseline()));
    setElapsed(0);
    setPhase("running");
  }, [dataset, enabled]);

  // 计时器：unmount / enabled 变化 / 跑完（phase → done）都会走到 cleanup。
  useEffect(() => {
    if (!enabled || phase !== "running") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const next = Date.now() - startedAt;
      if (next >= TOTAL_DURATION) {
        setElapsed(TOTAL_DURATION);
        setPhase("done");
        return;
      }
      setElapsed(next);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled, phase]);

  const progress = useMemo(() => progressAt(elapsed), [elapsed]);
  const counts = useMemo(() => countsAt(elapsed, selection), [elapsed, selection]);

  if (!enabled) {
    // 惰性：对外始终 idle，start 是空操作，图面拿到的也是「没有新增」。
    return {
      phase: "idle",
      stepIndex: 0,
      pct: 0,
      counts: IDLE_COUNTS,
      newNodeIds: NO_IDS,
      updatedNodeIds: NO_IDS,
      newEdgeIds: NO_IDS,
      rangeLabel,
      start: NOOP,
    };
  }

  return {
    phase,
    stepIndex: progress.stepIndex,
    pct: progress.pct,
    counts,
    newNodeIds: selection.newNodeIds,
    updatedNodeIds: selection.updatedNodeIds,
    newEdgeIds: selection.newEdgeIds,
    rangeLabel,
    start,
  };
}
