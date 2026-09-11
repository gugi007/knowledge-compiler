"use client";

import { useState } from "react";
import type {
  CompiledKnowledgeDataset,
  Concept,
  ReadingPath,
  Relation,
} from "@/data/models";
import {
  CONCEPT_LEVEL_LABELS,
  PATH_LEVEL_LABELS,
  RELATION_LABELS,
  conceptIndex,
  conceptRelations,
  summarize,
} from "@/lib/frontend/dataset";
import styles from "./compile.module.css";

/**
 * 校对视图（编译完成后的 review 步骤）——知乎风参考稿的三栏工作区。
 *
 * OWNER: compiler-ui-agent
 *
 * 三个区，对应 UX 规格的校对三件事：
 * 1. 概念校对——按概念排列的 chips（证据数降序，单色圆点，与参考稿一致），
 *    下方保留低置信度（<0.6）待确认列表与兜底句；
 * 2. 关系校对——每条概念关系给出方向语义、置信度与证据引文（锚定原文），
 *    describeRelation 文案生成逻辑与原版逐字一致，只换皮肤；
 * 3. 阅读路径——无框 hover 行，点击展开 summary（参考稿的超集，无害）。
 *
 * 只读审查：当前分支没有作者修改的持久层（架构文档缺口 C4），
 * 这里不做编辑动作；编辑入口属于第三幕的编辑模式。
 *
 * 样式全部来自 ./compile.module.css（参考稿 compiler.html 的移植），
 * 不再依赖 globals.css 的 .panel/.eyebrow 等共享类。
 */

/** 低于该置信度的概念在清单里置顶并标「待确认」。阈值是本幕的展示口径，不进入契约。 */
const LOW_CONFIDENCE = 0.6;
/** 关系区默认预览条数，其余收进「展开全部」。参考稿为 4。 */
const DEFAULT_ROWS = 4;

export function ReviewPanel({ dataset }: { dataset: CompiledKnowledgeDataset }) {
  return (
    <div className={`${styles.panel} ${styles.workspace}`}>
      <ConceptReview dataset={dataset} />
      <div className={styles.colMid}>
        <RelationReview dataset={dataset} />
      </div>
      <PathReview dataset={dataset} />
    </div>
  );
}

/* ---------- 1. 概念校对 ---------- */

function ConceptReview({ dataset }: { dataset: CompiledKnowledgeDataset }) {
  // chips 按概念排列（不再按领域分组）：证据文章数降序，其次置信度、id。
  const concepts = [...dataset.concepts].sort(
    (a, b) =>
      b.evidenceArticleIds.length - a.evidenceArticleIds.length ||
      b.confidence - a.confidence ||
      a.id.localeCompare(b.id),
  );

  const flagged = dataset.concepts
    .filter(({ confidence }) => confidence < LOW_CONFIDENCE)
    .sort((a, b) => a.confidence - b.confidence);

  return (
    <div>
      <div className={styles.colLabel}>
        <span>概念校对</span>
        <span className={styles.colLabelCnt}>{dataset.concepts.length}</span>
      </div>
      <div className={styles.chips}>
        {concepts.map((concept) => (
          <span className={styles.chip} key={concept.id}>
            <span aria-hidden className={styles.chipDot} />
            {concept.name}
            <span className={styles.chipN}>{concept.evidenceArticleIds.length}</span>
          </span>
        ))}
      </div>

      {flagged.length > 0 ? (
        <div className={styles.conceptNote}>
          <p>{flagged.length} 个概念置信度偏低，建议在知识空间里重点确认：</p>
          <ul className={styles.flagList}>
            {flagged.map((concept) => (
              <ConceptFlagRow concept={concept} key={concept.id} />
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.conceptNote}>
          所有概念置信度均高于 {LOW_CONFIDENCE.toFixed(1)}，无需重点确认项。
        </p>
      )}
    </div>
  );
}

function ConceptFlagRow({ concept }: { concept: Concept }) {
  return (
    <li className={styles.flagRow}>
      <span className={styles.flagName}>{concept.name}</span>
      <span className={styles.flagMeta}>{CONCEPT_LEVEL_LABELS[concept.level]}</span>
      <span className={styles.flagConf}>{concept.confidence.toFixed(2)}</span>
    </li>
  );
}

/* ---------- 2. 关系校对 ---------- */

/** 关系方向语义取自投影层注释（以 infer-relations 为准）：source 更基础 / source 更进阶。 */
function describeRelation(
  relation: Relation,
  byId: Map<string, Concept>,
): { source: Concept; target: Concept; phrase: string } | undefined {
  const source = byId.get(relation.sourceId);
  const target = byId.get(relation.targetId);
  if (!source || !target) return undefined;
  const label = RELATION_LABELS[relation.kind];
  const phrase =
    relation.kind === "prerequisite"
      ? `${source.name} 是 ${target.name} 的${label}`
      : relation.kind === "extends"
        ? `${source.name} ${label}了 ${target.name}`
        : `${source.name} 与 ${target.name} ${label}`;
  return { source, target, phrase };
}

function RelationReview({ dataset }: { dataset: CompiledKnowledgeDataset }) {
  const byId = conceptIndex(dataset);
  // 置信度低的排前面——校对视图先看不放心的。
  const relations = conceptRelations(dataset)
    .slice()
    .sort((a, b) => a.confidence - b.confidence || a.id.localeCompare(b.id));
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? relations : relations.slice(0, DEFAULT_ROWS);

  return (
    <div>
      <div className={styles.colLabel}>
        <span>关系校对 · 全部锚定原文</span>
        <span className={styles.colLabelCnt}>{relations.length}</span>
      </div>
      <div>
        {shown.map((relation) => {
          const described = describeRelation(relation, byId);
          if (!described) return null;
          const quote = relation.evidence[0]?.quote;
          return (
            <div className={styles.relCard} key={relation.id}>
              <div className={styles.relTitle}>{described.phrase}</div>
              <div className={styles.relMeta}>
                {RELATION_LABELS[relation.kind]} · 置信度{" "}
                {relation.confidence.toFixed(2)}
              </div>
              {quote && <div className={styles.relQuote}>“{quote}”</div>}
            </div>
          );
        })}
        {relations.length === 0 && (
          <p className={styles.conceptNote}>本次编译没有产生概念间关系。</p>
        )}
      </div>
      {relations.length > DEFAULT_ROWS && (
        <button
          className={styles.expandBtn}
          onClick={() => setShowAll((value) => !value)}
          type="button"
        >
          {showAll ? "收起" : `展开全部 ${relations.length} 条`}
        </button>
      )}
    </div>
  );
}

/* ---------- 3. 阅读路径确认 ---------- */

function PathReview({ dataset }: { dataset: CompiledKnowledgeDataset }) {
  return (
    <div>
      <div className={styles.colLabel}>
        <span>阅读路径</span>
        <span className={styles.colLabelCnt}>{dataset.readingPaths.length}</span>
      </div>
      <div>
        {dataset.readingPaths.map((path) => (
          <PathRow key={path.id} path={path} />
        ))}
        {dataset.readingPaths.length === 0 && (
          <p className={styles.conceptNote}>本次编译没有生成阅读路径。</p>
        )}
      </div>
    </div>
  );
}

function PathRow({ path }: { path: ReadingPath }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        aria-expanded={open}
        className={styles.pathRow}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>
          <span className={styles.pathTitle}>{path.title}</span>
          <span className={styles.pathMeta}>
            {PATH_LEVEL_LABELS[path.level]} · {path.conceptIds.length} 概念 ·{" "}
            {path.articleIds.length} 篇
          </span>
        </span>
        <svg
          aria-hidden
          className={`${styles.pathChev} ${open ? styles.pathChevOpen : ""}`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
      {open && <p className={styles.pathSummary}>{path.summary}</p>}
    </div>
  );
}

/** summarize 的 re-export 便于本目录内使用（完成视图的统计行）。 */
export { summarize };
