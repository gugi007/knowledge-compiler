import type { Relation, RelationKind } from "./models.ts";

/**
 * 作者的修改单独存一层，compiled.json 永远是纯编译产物、不被改写。
 * 这样编译可复现，差异计算也不会被人工修改污染。
 */

/**
 * 作者意图的关系动词，比 RelationKind 细。
 * overlay 存动词（无损保留作者的选择），应用时投影到 kind 并重算 relation id，
 * 产物仍然是合法的 CompiledKnowledgeDataset，现有渲染器不用改。
 */
export type RelationVerb =
  | "depends"
  | "improves"
  | "contrasts"
  | "prerequisite"
  | "counterexample";

export const RELATION_VERB_LABELS: Record<RelationVerb, string> = {
  depends: "依赖",
  improves: "改进",
  contrasts: "对比",
  prerequisite: "前置",
  counterexample: "反例",
};

export interface VerbProjection {
  kind: Exclude<RelationKind, "article-concept">;
  /**
   * 作者写的是「A 动词 B」，但存进 dataset 时要不要翻成 source=B / target=A。
   * 方向语义以 infer-relations.ts 的 levelConsistent 为准：
   * prerequisite 要求 source 更基础，extends 要求 source 更进阶。
   * 所以「A 依赖 B」= B 是 A 的前置 = source=B, target=A，需要翻转。
   */
  flipsDirection: boolean;
  /** related 是无向的，端点按字典序排（与 infer-relations.ts 的 makeRelation 一致）。 */
  undirected: boolean;
}

export const RELATION_VERB_PROJECTIONS: Record<RelationVerb, VerbProjection> = {
  // 「A 依赖 B」→ B 是前置，source=B target=A
  depends: { kind: "prerequisite", flipsDirection: true, undirected: false },
  // 「A 是 B 的前置」→ source=A target=B
  prerequisite: { kind: "prerequisite", flipsDirection: false, undirected: false },
  // 「A 改进 B」→ A 更进阶，extends 要求 source 更进阶
  improves: { kind: "extends", flipsDirection: false, undirected: false },
  // 对比与反例在 dataset 里都落成无向的 related；方向只保留在 overlay 的动词上，
  // 渲染时由 UI 从 OverlayAnnotations.verbs 读回。反例是有向语义，这里是有损投影。
  contrasts: { kind: "related", flipsDirection: false, undirected: true },
  counterexample: { kind: "related", flipsDirection: false, undirected: true },
};

/**
 * 概念的定位键。概念 id 由 LLM 选的 slug 派生（normalize-concepts.ts），
 * 两次独立编译可能改名，所以每条修改都带三重锚点：
 * 解析顺序 id → name/aliases → slug，都失败就静默 no-op。
 * 这正是 overlay 能活过一次全量重编译的原因。
 */
export interface ConceptKey {
  /** 写入时的概念 id 快照，重编译后可能失效。 */
  id?: string;
  slug?: string;
  /** 写入时 normalizeConceptName(name) 的结果，跨编译最稳的锚。 */
  name: string;
}

export interface RelationKey {
  /** 写入时的关系 id 快照。 */
  id?: string;
  source: ConceptKey;
  target: ConceptKey;
  /** 编辑当时这条关系的 kind，id 失效后用来按端点 + kind 兜底定位。 */
  kindAtEdit: RelationKind;
}

/**
 * append-only。撤销不改写历史，而是追加一条反向条目（cancels 指向被撤销条目的下标），
 * 这样「修改即记录」成立，观点演变时间线能读到完整的编辑史。
 */
export type OverlayEntry =
  | { op: "merge-concepts"; at: string; keep: ConceptKey; merged: ConceptKey[] }
  | { op: "split-concepts"; at: string; cancels: number }
  | { op: "rename-concept"; at: string; target: ConceptKey; newName: string }
  | { op: "confirm-relation"; at: string; target: RelationKey }
  | { op: "retype-relation"; at: string; target: RelationKey; verb: RelationVerb; archivedRelation: ArchivedRelation }
  | { op: "delete-relation"; at: string; target: RelationKey; archivedRelation: ArchivedRelation }
  | { op: "restore-relation"; at: string; cancels: number }
  | { op: "mark-viewpoint"; at: string; target: ConceptKey; note?: string };

/**
 * 被删除或改类型的关系原样归档在这里，支撑「证据句已归档，可随时撤销」。
 * 用独立类型而不是直接引 Relation，是为了明确它是快照、不随 dataset 变化。
 */
export type ArchivedRelation = Relation;

export interface EditOverlay {
  overlayVersion: "1.0";
  /** 对应语料 id，与 /api/compile 的 corpus、知识花园的 source 同一组值。 */
  corpusKey: string;
  entries: OverlayEntry[];
}

/** 渲染期从 overlay 读出的批注。这些不改动 dataset，由 UI 叠加显示。 */
export interface ViewpointMark {
  conceptId: string;
  at: string;
  note?: string;
}

export interface OverlayAnnotations {
  /** 作者已确认的关系 id（已解析到当前 dataset 的 id）。 */
  confirmedRelationIds: string[];
  /** 观点标记，按时间升序。 */
  viewpoints: ViewpointMark[];
  /** 作者改过类型的关系，动词保留作者意图（可能比 dataset 里的 kind 更细）。 */
  verbs: { relationId: string; verb: RelationVerb }[];
  /** 被 overlay 合并掉、已不在 dataset 里的概念名，供 UI 说明「已合并」。 */
  mergedAwayNames: string[];
}
