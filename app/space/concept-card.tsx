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

/**
 * 概念档案卡：右栏（宽屏）或底部抽屉（窄屏）共用的内容。
 *
 * OWNER: knowledge-space-agent
 *
 * 取数全部走 lib/frontend/dataset.ts 投影层，不自己遍历 relations——
 * 关系方向与 article-concept 口径集中在投影层，避免与画布/时间轴分叉。
 *
 * 内容分四块：
 * 1. 头：名称 / 领域 / 级别 / 置信度 / 摘要
 * 2. 观点演变：按回链文章时间线列出「这个概念在哪篇被怎么讨论」
 * 3. 关系网络：邻接关系（前置/相关/延伸），可跳转到另一端概念
 * 4. 原文证据：去重后的引文，标注出处文章
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
  // 方向语义以编译器为准：prerequisite 的 source 更基础，extends 的 source 更进阶。
  if (kind === "prerequisite") {
    return (
      <span className="text-ink/55">
        {direction === "incoming" ? (
          <>需要先理解 <strong className="text-ink/80">{otherName}</strong></>
        ) : (
          <>是 <strong className="text-ink/80">{otherName}</strong> 的前置</>
        )}
      </span>
    );
  }
  if (kind === "extends") {
    return (
      <span className="text-ink/55">
        {direction === "outgoing" ? (
          <>延伸出 <strong className="text-ink/80">{otherName}</strong></>
        ) : (
          <>由 <strong className="text-ink/80">{otherName}</strong> 延伸而来</>
        )}
      </span>
    );
  }
  return (
    <span className="text-ink/55">
      与 <strong className="text-ink/80">{otherName}</strong> 相关
    </span>
  );
}

export function ConceptCard({
  dataset,
  concept,
  onSelectConcept,
  onClose,
  headerSlot,
}: {
  dataset: CompiledKnowledgeDataset;
  concept: Concept;
  onSelectConcept: (id: string) => void;
  /** 抽屉形态时提供关闭按钮。 */
  onClose?: () => void;
  /** 追加在头部的编辑动作区（编辑模式时由父级注入）。 */
  headerSlot?: React.ReactNode;
}) {
  const concepts = useMemo(() => conceptIndex(dataset), [dataset]);
  const articles = useMemo(() => articleIndex(dataset), [dataset]);
  const neighbors = useMemo(() => neighborsOf(dataset, concept.id), [dataset, concept.id]);
  const backlinks = useMemo(() => backlinksOf(dataset, concept.id), [dataset, concept.id]);
  const quotes = useMemo(() => evidenceQuotesFor(dataset, concept.id), [dataset, concept.id]);

  return (
    <div className="grid gap-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-wider text-ink/40 uppercase">
              {concept.domain} · {CONCEPT_LEVEL_LABELS[concept.level]} · 置信度{" "}
              {Math.round(concept.confidence * 100)}%
            </p>
            <h2 className="mt-1 font-display text-xl leading-7 font-semibold break-words">
              {concept.name}
            </h2>
          </div>
          {onClose && (
            <button
              aria-label="关闭概念档案"
              className="shrink-0 rounded-md border border-ink/10 px-2 py-1 text-xs font-bold text-ink/50 hover:border-coral hover:text-coral"
              onClick={onClose}
              type="button"
            >
              ✕
            </button>
          )}
        </div>
        {concept.aliases.length > 0 && (
          <p className="mt-1 text-[11px] text-ink/40">别名：{concept.aliases.join("、")}</p>
        )}
        <p className="mt-3 text-sm leading-6 text-ink/70">{concept.summary}</p>
        {headerSlot}
      </div>

      {/* 观点演变：回链文章按时间排，呈现概念被讨论的过程。 */}
      <section>
        <p className="eyebrow">观点演变 · {backlinks.length} 篇</p>
        {backlinks.length ? (
          <ol className="mt-3 grid gap-0 border-l border-ink/15 pl-4">
            {backlinks.map((article: Article) => (
              <li className="relative py-2" key={article.id}>
                <span
                  aria-hidden
                  className="absolute top-3.5 -left-[21px] size-2 rounded-full border border-coral bg-white"
                />
                <p className="font-mono text-[10px] text-ink/40">
                  {formatDate(article.publishedAt)}
                </p>
                <a
                  className="mt-0.5 block text-xs leading-5 font-bold text-ink/75 hover:text-coral"
                  href={article.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {article.title}
                </a>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-ink/50">
                  {article.summary}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-ink/40">暂无回链文章。</p>
        )}
      </section>

      {/* 关系网络。 */}
      <section>
        <p className="eyebrow">关系网络 · {neighbors.length} 条</p>
        <div className="mt-3 grid gap-1.5">
          {neighbors.length ? (
            neighbors.map(({ relation, direction, otherConceptId }) => {
              const other = concepts.get(otherConceptId);
              if (!other) return null;
              return (
                <button
                  className="relation-row"
                  key={relation.id}
                  onClick={() => onSelectConcept(otherConceptId)}
                  type="button"
                >
                  <span className="min-w-0 truncate text-xs">
                    <RelationDirection
                      direction={direction}
                      kind={relation.kind}
                      otherName={other.name}
                    />
                  </span>
                  <span className="relation-kind shrink-0">
                    {RELATION_LABELS[relation.kind]}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="text-xs text-ink/40">暂无与其他概念的关系。</p>
          )}
        </div>
      </section>

      {/* 原文证据。 */}
      <section>
        <p className="eyebrow">原文证据 · {quotes.length} 条</p>
        {quotes.length ? (
          <ul className="mt-3 grid gap-2">
            {quotes.slice(0, 6).map(({ articleId, quote }, index) => (
              <li className="rounded-lg bg-ink/5 p-2.5" key={`${articleId}:${index}`}>
                <p className="mb-1 text-[10px] font-bold text-ink/45">
                  {articles.get(articleId)?.title ?? articleId}
                </p>
                <blockquote className="text-xs leading-5 text-ink/70">“{quote}”</blockquote>
              </li>
            ))}
            {quotes.length > 6 && (
              <li className="text-center font-mono text-[10px] text-ink/35">
                +{quotes.length - 6} 条更多
              </li>
            )}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink/40">暂无引文。</p>
        )}
      </section>
    </div>
  );
}
