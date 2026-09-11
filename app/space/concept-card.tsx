"use client";

import { useMemo } from "react";
import type { Article, CompiledKnowledgeDataset, Concept } from "@/data/models";
import {
  articleIndex,
  backlinksOf,
  CONCEPT_LEVEL_LABELS,
  conceptIndex,
  evidenceQuotesFor,
  neighborsOf,
  RELATION_LABELS,
} from "@/lib/frontend/dataset";
import { LatexText } from "./latex-text";
import s from "./space.module.css";

/**
 * 右栏「概念档案」（批次 5/5 视觉重绘）。
 *
 * 结构对齐参考稿：面包屑 → 标题 → 摘要 → 观点演变时间线 → 关系网络 → 原文证据。
 * 对外 props（dataset / concept / onSelectConcept / headerSlot）。
 *
 * 硬约束：所有 LatexText 包裹原样保留（数学公式走 MathJax 惰性加载），
 * 全文共 3 处：概念摘要、时间线条目摘要、原文证据引文。
 */

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short" }).format(
    new Date(date),
  );
}

function RelationDirection({
  direction,
  kind,
  otherName,
}: {
  direction: "outgoing" | "incoming";
  kind: string;
  otherName: string;
}) {
  if (kind === "prerequisite") {
    return (
      <span>
        {direction === "incoming" ? (
          <>
            需要先理解 <b>{otherName}</b>
          </>
        ) : (
          <>
            是 <b>{otherName}</b> 的前置
          </>
        )}
      </span>
    );
  }
  if (kind === "extends") {
    return (
      <span>
        {direction === "outgoing" ? (
          <>
            延伸出 <b>{otherName}</b>
          </>
        ) : (
          <>
            由 <b>{otherName}</b> 延伸而来
          </>
        )}
      </span>
    );
  }
  return (
    <span>
      与 <b>{otherName}</b> 相关
    </span>
  );
}

export function ConceptCard({
  dataset,
  concept,
  onSelectConcept,
  onSelectEdge,
  selectedEdgeId,
  headerSlot,
}: {
  dataset: CompiledKnowledgeDataset;
  concept: Concept;
  onSelectConcept: (id: string) => void;
  onSelectEdge?: (edgeId: string | undefined) => void;
  selectedEdgeId?: string;
  headerSlot?: React.ReactNode;
}) {
  const concepts = useMemo(() => conceptIndex(dataset), [dataset]);
  const articles = useMemo(() => articleIndex(dataset), [dataset]);
  const neighbors = useMemo(() => neighborsOf(dataset, concept.id), [dataset, concept.id]);
  const backlinks = useMemo(() => backlinksOf(dataset, concept.id), [dataset, concept.id]);
  const quotes = useMemo(() => evidenceQuotesFor(dataset, concept.id), [dataset, concept.id]);
  /** backlinksOf 按 publishedAt 升序返回，最后一条即最新，标 hot。 */
  const latestBacklinkId = backlinks.length ? backlinks[backlinks.length - 1]!.id : undefined;

  return (
    <div className={s.card}>
      {/* ------------------------------------------------- 面包屑 + 标题 */}
      <div className={s.cardHead}>
        <p className={`${s.insBreadcrumb} ${s.cardBreadcrumb}`}>
          {concept.domain} · {CONCEPT_LEVEL_LABELS[concept.level]} · 置信度{" "}
          {Math.round(concept.confidence * 100)}%
        </p>
      </div>
      <h2 className={s.insTitle}>{concept.name}</h2>
      {concept.aliases.length > 0 && (
        <p className={s.cardAliases}>别名：{concept.aliases.join("、")}</p>
      )}

      {/* ------------------------------------------------------- 摘要 */}
      <div className={s.insSummary}>
        <span className={s.insSummaryLabel}>概念摘要</span>
        <p className={s.insSummaryText}>
          <LatexText className={s.latexFull}>{concept.summary}</LatexText>
        </p>
      </div>

      {headerSlot}

      {/* --------------------------------------------------- 观点演变 */}
      <section className={s.insBlock}>
        <div className={s.insBlockHead}>
          <span className={s.insBlockTitle}>观点演变</span>
          <span className={s.insBlockCount}>{backlinks.length} 篇</span>
        </div>
        {backlinks.length ? (
          <div className={s.tl}>
            {backlinks.map((article: Article) => (
              <div
                className={`${s.tlItem} ${article.id === latestBacklinkId ? s.hot : ""}`}
                key={article.id}
              >
                <div className={s.tlDate}>{formatDate(article.publishedAt)}</div>
                {article.sourceUrl ? (
                  <a
                    className={`${s.tlTitle} ${s.tlTitleLink}`}
                    href={article.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {article.title}
                  </a>
                ) : (
                  <div className={s.tlTitle}>{article.title}</div>
                )}
                <div className={s.tlSummary}>
                  <LatexText className={s.latexFull}>{article.summary}</LatexText>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={s.cardEmpty}>暂无回链文章。</p>
        )}
      </section>

      {/* --------------------------------------------------- 关系网络 */}
      <section className={s.insBlock}>
        <div className={s.insBlockHead}>
          <span className={s.insBlockTitle}>关系网络</span>
          <span className={s.insBlockCount}>{neighbors.length} 条</span>
        </div>
        {neighbors.length ? (
          neighbors.map(({ relation, direction, otherConceptId }) => {
            const other = concepts.get(otherConceptId);
            if (!other) return null;
            const edgeOn = selectedEdgeId === relation.id;
            return (
              <div
                className={`${s.relRow} ${edgeOn ? s.relRowOn : ""}`}
                key={relation.id}
                onClick={() =>
                  onSelectEdge?.(edgeOn ? undefined : relation.id)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectEdge?.(edgeOn ? undefined : relation.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className={s.relText}>
                  <RelationDirection
                    direction={direction}
                    kind={relation.kind}
                    otherName={other.name}
                  />
                </span>
                <span className={s.relKind}>{RELATION_LABELS[relation.kind]}</span>
                <button
                  aria-label={`查看 ${other.name}`}
                  className={s.relJump}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectConcept(otherConceptId);
                  }}
                  type="button"
                >
                  ↗
                </button>
              </div>
            );
          })
        ) : (
          <p className={s.cardEmpty}>暂无与其他概念的关系。</p>
        )}
      </section>

      {/* --------------------------------------------------- 原文证据 */}
      <section className={s.insBlock}>
        <div className={s.insBlockHead}>
          <span className={s.insBlockTitle}>原文证据</span>
          <span className={s.insBlockCount}>{quotes.length} 条</span>
        </div>
        {quotes.length ? (
          <>
            {quotes.slice(0, 6).map(({ articleId, quote }, index) => {
              const article = articles.get(articleId);
              return (
                <div className={s.ev} key={`${articleId}:${index}`}>
                  <div className={s.evSrc}>
                    <span className={s.evTitle}>{article?.title ?? articleId}</span>
                    {article?.sourceUrl && (
                      <a
                        className={s.evGo}
                        href={article.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        查看原文 →
                      </a>
                    )}
                  </div>
                  <div className={s.evQuote}>
                    “<LatexText>{quote}</LatexText>”
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <p className={s.cardEmpty}>暂无引文。</p>
        )}
      </section>
    </div>
  );
}
