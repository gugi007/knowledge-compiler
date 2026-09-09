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
  conceptsByDomain,
  conceptRelations,
  neighborsOf,
} from "@/lib/frontend/dataset";
import { domainTone } from "./stage-presenters";

/**
 * 校对视图（编译完成后的 review 步骤）。
 *
 * 三个区，对应 UX 规格的校对三件事：
 * 1. 概念校对——按领域分组的候选清单，标出低置信度项，请作者重点确认；
 * 2. 关系校对——每条概念关系给出方向语义、置信度与证据引文（锚定原文）；
 * 3. 阅读路径——编译器排出的有序路线，确认后进入知识空间。
 *
 * 只读审查：当前分支没有作者修改的持久层（架构文档缺口 C4），
 * 这里不做编辑动作；编辑入口属于第三幕的编辑模式。
 */

/** 低于该置信度的概念在清单里置顶并标「待确认」。阈值是本幕的展示口径，不进入契约。 */
const LOW_CONFIDENCE = 0.6;
/** 每区默认展开的条数，其余收进「展开更多」。 */
const DEFAULT_ROWS = 6;

export function ReviewPanel({ dataset }: { dataset: CompiledKnowledgeDataset }) {
  return (
    <section className="panel mt-4 p-5 md:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="eyebrow">Review · 校对</p>
          <h2 className="mt-1 font-display text-xl font-semibold">
            确认编译结果，再进入知识空间
          </h2>
        </div>
        <p className="font-mono text-[10px] text-ink/40">
          全部关系锚定原文 · 修改请在知识空间的编辑模式进行
        </p>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-3">
        <ConceptReview dataset={dataset} />
        <RelationReview dataset={dataset} />
        <PathReview dataset={dataset} />
      </div>
    </section>
  );
}

/* ---------- 1. 概念校对 ---------- */

function ConceptReview({ dataset }: { dataset: CompiledKnowledgeDataset }) {
  const groups = conceptsByDomain(dataset);
  const [showAll, setShowAll] = useState(false);

  const flagged = dataset.concepts
    .filter(({ confidence }) => confidence < LOW_CONFIDENCE)
    .sort((a, b) => a.confidence - b.confidence);
  const shown = showAll ? flagged : flagged.slice(0, DEFAULT_ROWS);

  return (
    <div>
      <p className="eyebrow">概念校对</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {groups.map(({ domain, concepts }) => (
          <span
            className="concept-pill cursor-default"
            key={domain}
            style={{ borderColor: domainTone(domain).solid }}
          >
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: domainTone(domain).solid }}
            />
            {domain}
            <span className="font-mono text-[10px] text-ink/40">{concepts.length}</span>
          </span>
        ))}
      </div>

      {flagged.length > 0 ? (
        <div className="mt-4">
          <p className="text-[12px] leading-5 text-ink/55">
            {flagged.length} 个概念置信度偏低，建议在知识空间里重点确认：
          </p>
          <ul className="mt-2 grid gap-1">
            {shown.map((concept) => (
              <ConceptFlagRow concept={concept} key={concept.id} />
            ))}
          </ul>
          {flagged.length > DEFAULT_ROWS && (
            <button
              className="mt-2 text-[11px] font-bold text-ink/45 underline-offset-2 transition hover:text-ink/70 hover:underline"
              onClick={() => setShowAll((value) => !value)}
              type="button"
            >
              {showAll ? "收起" : `展开其余 ${flagged.length - DEFAULT_ROWS} 个`}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-4 text-[12px] leading-5 text-ink/50">
          所有概念置信度均高于 {LOW_CONFIDENCE.toFixed(1)}，无需重点确认项。
        </p>
      )}
    </div>
  );
}

function ConceptFlagRow({ concept }: { concept: Concept }) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-50/60 px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink/75">
        {concept.name}
      </span>
      <span className="flex-none font-mono text-[9px] tracking-wider text-ink/40 uppercase">
        {CONCEPT_LEVEL_LABELS[concept.level]}
      </span>
      <span className="flex-none font-mono text-[10px] text-amber-700">
        {concept.confidence.toFixed(2)}
      </span>
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
      <p className="eyebrow">关系校对</p>
      <ul className="mt-3 grid gap-1.5">
        {shown.map((relation) => {
          const described = describeRelation(relation, byId);
          if (!described) return null;
          const quote = relation.evidence[0]?.quote;
          return (
            <li
              className="rounded-xl border border-ink/10 bg-white p-2.5"
              key={relation.id}
            >
              <p className="text-[13px] leading-5 font-bold text-ink/75">
                {described.phrase}
              </p>
              <p className="mt-0.5 font-mono text-[9px] tracking-wider text-ink/40 uppercase">
                {RELATION_LABELS[relation.kind]} · 置信度 {relation.confidence.toFixed(2)}
              </p>
              {quote && (
                <blockquote className="mt-1.5 border-l-2 border-coral/40 pl-2 text-[11px] leading-4 text-ink/50">
                  “{quote}”
                </blockquote>
              )}
            </li>
          );
        })}
        {relations.length === 0 && (
          <li className="text-[12px] text-ink/45">本次编译没有产生概念间关系。</li>
        )}
      </ul>
      {relations.length > DEFAULT_ROWS && (
        <button
          className="mt-2 text-[11px] font-bold text-ink/45 underline-offset-2 transition hover:text-ink/70 hover:underline"
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
      <p className="eyebrow">阅读路径</p>
      <ul className="mt-3 grid gap-1.5">
        {dataset.readingPaths.map((path) => (
          <PathRow key={path.id} path={path} />
        ))}
        {dataset.readingPaths.length === 0 && (
          <li className="text-[12px] text-ink/45">本次编译没有生成阅读路径。</li>
        )}
      </ul>
    </div>
  );
}

function PathRow({ path }: { path: ReadingPath }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="reading-path">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold">{path.title}</span>
          <span className="mt-0.5 block font-mono text-[9px] tracking-wider text-ink/40 uppercase">
            {PATH_LEVEL_LABELS[path.level]} · {path.conceptIds.length} 概念 ·{" "}
            {path.articleIds.length} 篇
          </span>
        </span>
        <span
          aria-hidden
          className={`flex-none text-ink/35 transition ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
      </button>
      {open && (
        <p className="mt-2 border-t border-ink/5 pt-2 text-[12px] leading-5 text-ink/55">
          {path.summary}
        </p>
      )}
    </li>
  );
}

/**
 * 校对区的邻接抽样：随机看一个概念的关系网。
 * 目前未挂进 ReviewPanel——保留给后续「抽一条让作者确认」的交互。
 */
export function sampleNeighbors(dataset: CompiledKnowledgeDataset) {
  const first = dataset.concepts[0];
  return first ? neighborsOf(dataset, first.id) : [];
}
