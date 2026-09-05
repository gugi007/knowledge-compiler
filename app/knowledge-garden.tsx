"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import rawDataset from "@/data/demo/compiled.json";
import rawSujianlinDataset from "@/data/sujianlin/compiled.json";
import type {
  Article,
  CompiledKnowledgeDataset,
  Concept,
  Relation,
} from "@/data/models";
import { assertCompiledKnowledgeDataset } from "@/lib/compiler/schema";

const demoData = rawDataset as CompiledKnowledgeDataset;
const sujianlinData = rawSujianlinDataset as CompiledKnowledgeDataset;
const emptySubscribe = () => () => {};
const emptySnapshot = () => null;

function sourceParamSnapshot() {
  return new URLSearchParams(window.location.search).get("source");
}

function compiledDatasetSnapshot() {
  if (sourceParamSnapshot() !== "compiled") return null;
  return sessionStorage.getItem("knowledge-compiler:dataset");
}

const domainColors: Record<string, string> = {
  模型基础: "#0066ff",
  注意力机制: "#7c6cff",
  推理系统: "#12a182",
  长上下文: "#f07b3f",
  通用方法: "#9aa0a6",
};

const relationLabels: Record<Relation["kind"], string> = {
  "article-concept": "讨论",
  prerequisite: "前置",
  related: "相关",
  extends: "延伸",
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
  }).format(new Date(date));
}

export function KnowledgeGarden() {
  const source = useSyncExternalStore(emptySubscribe, sourceParamSnapshot, emptySnapshot);
  const staticData = source === "sujianlin" ? sujianlinData : demoData;
  const savedDataset = useSyncExternalStore(emptySubscribe, compiledDatasetSnapshot, emptySnapshot);
  const data = useMemo(() => {
    if (!savedDataset) return staticData;
    try {
      const dataset: unknown = JSON.parse(savedDataset);
      assertCompiledKnowledgeDataset(dataset);
      return dataset;
    } catch {
      return staticData;
    }
  }, [savedDataset, staticData]);
  const [selectedId, setSelectedId] = useState(
    demoData.concepts.find(({ slug }) => slug === "kv-cache")?.id ?? demoData.concepts[0].id,
  );
  const selected = data.concepts.find((concept) => concept.id === selectedId) ?? data.concepts[0];

  const conceptById = useMemo(
    () => new Map(data.concepts.map((concept) => [concept.id, concept])),
    [data.concepts],
  );
  const articleById = useMemo(
    () => new Map(data.articles.map((article) => [article.id, article])),
    [data.articles],
  );

  const conceptRelations = data.relations.filter(
    (relation) => relation.kind !== "article-concept",
  );
  const relatedArticles = data.relations
    .filter(
      (relation) =>
        relation.kind === "article-concept" && relation.targetId === selected.id,
    )
    .map((relation) => articleById.get(relation.sourceId))
    .filter((article) => article !== undefined);
  const prerequisites = conceptRelations
    .filter(
      (relation) =>
        relation.kind === "prerequisite" && relation.targetId === selected.id,
    )
    .map((relation) => conceptById.get(relation.sourceId))
    .filter((concept) => concept !== undefined);
  const connectedRelations = conceptRelations.filter(
    (relation) => relation.sourceId === selected.id || relation.targetId === selected.id,
  );
  const readingPaths = data.readingPaths.filter((path) =>
    path.conceptIds.includes(selected.id),
  );
  const domains = [...new Set(data.concepts.map((concept) => concept.domain))];

  return (
    <main className="min-h-screen px-4 py-4 md:px-6 lg:px-8">
      <header className="glass-bar mx-auto mb-4 flex max-w-[1500px] items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-ink text-sm font-black text-paper">KC</div>
          <div>
            <p className="font-display text-xl leading-none font-semibold">Knowledge Compiler</p>
            <p className="mt-1 text-[10px] font-bold tracking-[0.22em] text-ink/45 uppercase">Personal knowledge network</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 text-xs font-semibold text-ink/60 sm:flex">
          <span className="status-dot" />
          {data.compiler.mode === "mock" ? "Demo · deterministic mock" : data.compiler.mode}
          <Link className="ml-3 rounded-full bg-coral px-3 py-1.5 text-white hover:bg-[#004bbb]" href="/compile">Compile</Link>
        </div>
      </header>

      <section className="mx-auto mt-5 grid max-w-[1500px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)_350px]">
        <aside className="panel overflow-hidden lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <div className="border-b border-ink/10 p-5">
            <div className="flex items-start gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-full bg-coral font-display text-lg font-bold text-white ring-2 ring-coral/20 ring-offset-2">{data.creator.name[0]}</div>
              <div>
                <h1 className="font-display text-xl font-semibold">{data.creator.name}</h1>
                <p className="text-xs font-semibold text-ink/45">{data.creator.handle}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-ink/65">{data.creator.bio}</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Stat value={data.articles.length} label="Articles" />
              <Stat value={data.concepts.length} label="Concepts" />
              <Stat value={data.relations.length} label="Relations" />
            </div>
            <div className="mt-3 rounded-xl border border-[#c2dbff] bg-lime px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-bold tracking-[0.15em] text-coral/70 uppercase">Compiler</span>
                <span className="rounded-full bg-coral px-2 py-0.5 text-[9px] font-black tracking-wide text-white uppercase">
                  {data.compiler.mode === "mock" ? "Demo / deterministic mock" : data.compiler.mode}
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-ink/55">provider: {data.compiler.provider}</p>
            </div>
          </div>

          <div className="scrollbar h-[calc(100%-230px)] overflow-y-auto p-3">
            <div className="mb-3 flex items-center justify-between px-2">
              <h2 className="eyebrow">Concept hierarchy</h2>
              <span className="text-[10px] font-bold text-ink/35">{domains.length} DOMAINS</span>
            </div>
            {domains.map((domain) => (
              <div className="mb-4" key={domain}>
                <p className="mb-1 flex items-center gap-2 px-2 py-1 text-xs font-bold text-ink/55">
                  <span className="size-2 rounded-full" style={{ background: domainColors[domain] }} />
                  {domain}
                </p>
                <div className="space-y-0.5">
                  {data.concepts
                    .filter((concept) => concept.domain === domain)
                    .map((concept) => (
                      <button
                        className={`concept-link ${selected.id === concept.id ? "concept-link-active" : ""}`}
                        key={concept.id}
                        onClick={() => setSelectedId(concept.id)}
                        type="button"
                      >
                        <span className="truncate">{concept.name}</span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <section className="panel hero-gradient relative overflow-hidden p-6 md:p-8">
            <div key={selected.id} className="relative hero-in">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow">Personal Wiki / {selected.domain}</span>
                <span className="rounded-full border border-ink/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink/50 uppercase">{selected.level}</span>
              </div>
              <h2 className="mt-5 max-w-3xl font-display text-4xl leading-none font-semibold tracking-tight md:text-6xl">{selected.name}</h2>
              <p className="mt-5 max-w-3xl text-base leading-7 text-ink/70 md:text-lg md:leading-8">{selected.summary}</p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs font-bold">
                <span className="tag">{relatedArticles.length} 篇回链文章</span>
                <span className="tag">{prerequisites.length} 个前置概念</span>
                <span className="tag">{readingPaths.length} 条阅读路径</span>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
            <div className="panel p-5 md:p-6">
              <div className="mb-5 flex items-end justify-between gap-4">
                <div>
                  <p className="eyebrow">Backlinks</p>
                  <h3 className="mt-1 font-display text-2xl font-semibold">相关文章</h3>
                </div>
                <span className="text-xs text-ink/45">按时间倒序</span>
              </div>
              <div className="divide-y divide-ink/10">
                {[...relatedArticles].reverse().map((article, index) => (
                  <article className="group grid grid-cols-[28px_1fr_auto] gap-3 py-4 first:pt-0 last:pb-0" key={article.id}>
                    <span className="pt-1 font-mono text-xs font-bold text-ink/30">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h4 className="font-display text-lg leading-6 font-semibold transition-colors group-hover:text-coral">{article.title}</h4>
                      <p className="mt-1 text-sm leading-5 text-ink/55">{article.summary}</p>
                    </div>
                    <div className="whitespace-nowrap pt-1 text-right text-[10px] font-bold tracking-wide text-ink/40 uppercase">
                      <p>{formatDate(article.publishedAt)}</p>
                      <p className="mt-1">{article.readingTimeMinutes} min</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <RelationCard
                title="Prerequisites"
                subtitle="先理解这些"
                concepts={prerequisites}
                onSelect={setSelectedId}
              />
              <div className="panel p-5">
                <p className="eyebrow">Related & extends</p>
                <h3 className="mt-1 font-display text-xl font-semibold">概念连接</h3>
                <div className="mt-4 space-y-2">
                  {connectedRelations.length ? connectedRelations.map((relation) => (
                    <RelationDetail
                      articleById={articleById}
                      conceptById={conceptById}
                      key={relation.id}
                      onSelect={setSelectedId}
                      relation={relation}
                      selectedId={selected.id}
                    />
                  )) : <p className="text-sm text-ink/45">暂无直接连接。</p>}
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="panel overflow-hidden">
            <div className="flex items-end justify-between p-5 pb-2">
              <div>
                <p className="eyebrow">Knowledge graph</p>
                <h2 className="mt-1 font-display text-2xl font-semibold">知识关系图</h2>
              </div>
              <span className="text-[10px] font-bold text-ink/40">点击节点</span>
            </div>
            <KnowledgeGraph data={data} selected={selected} onSelect={setSelectedId} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-ink/10 px-5 py-3 text-[10px] font-bold text-ink/45">
              <span><i className="mr-1 inline-block h-px w-4 bg-coral align-middle" /> 前置</span>
              <span><i className="mr-1 inline-block h-px w-4 border-t border-dashed border-ink/50 align-middle" /> 相关 / 延伸</span>
            </div>
          </section>

          <section className="panel p-5">
            <p className="eyebrow">Reading paths</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">从这里继续</h2>
            <div className="mt-4 space-y-3">
              {readingPaths.length ? readingPaths.map((path) => (
                <article className="reading-path" key={path.id}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-lg font-semibold">{path.title}</h3>
                    <span className="rounded-full bg-ink px-2 py-1 text-[9px] font-bold tracking-wide text-paper uppercase">{path.level}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ink/55">{path.summary}</p>
                  <ol className="mt-4 flex items-center gap-1 overflow-hidden" aria-label={`${path.title}概念顺序`}>
                    {path.conceptIds.map((conceptId, index) => (
                      <li className="flex min-w-0 items-center gap-1" key={conceptId}>
                        <button
                          aria-label={`查看 ${conceptById.get(conceptId)?.name}`}
                          className={`path-step ${conceptId === selected.id ? "path-step-active" : ""}`}
                          onClick={() => setSelectedId(conceptId)}
                          title={conceptById.get(conceptId)?.name}
                          type="button"
                        >
                          {index + 1}
                        </button>
                        {index < path.conceptIds.length - 1 && <span className="text-ink/25">—</span>}
                      </li>
                    ))}
                  </ol>
                </article>
              )) : <p className="rounded-xl bg-ink/5 p-4 text-sm leading-6 text-ink/55">这个概念暂未收录进阅读路径，可从左侧层级继续探索。</p>}
            </div>
          </section>

          <section className="before-after">
            <div>
              <span>BEFORE</span>
              <strong>{data.articles.length} 篇散落文章</strong>
            </div>
            <span aria-hidden="true" className="text-xl">→</span>
            <div className="text-right">
              <span>AFTER</span>
              <strong>1 个知识世界</strong>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function RelationDetail({
  relation,
  selectedId,
  conceptById,
  articleById,
  onSelect,
}: {
  relation: Relation;
  selectedId: string;
  conceptById: Map<string, Concept>;
  articleById: Map<string, Article>;
  onSelect: (id: string) => void;
}) {
  const source = conceptById.get(relation.sourceId);
  const target = conceptById.get(relation.targetId);
  const related = relation.sourceId === selectedId ? target : source;
  if (!source || !target || !related) return null;

  return (
    <details className="group rounded-xl border border-ink/10 bg-white/40 open:border-ink/25 open:bg-white/65">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-bold">
        <span className="min-w-0 truncate">{source.name} <span className="text-ink/25">→</span> {target.name}</span>
        <span className="relation-kind shrink-0">{relationLabels[relation.kind]}</span>
      </summary>
      <div className="border-t border-ink/10 px-3 py-3">
        <div className="flex items-center justify-between gap-2 text-[10px] font-bold tracking-wide text-ink/45 uppercase">
          <span>为什么连接？</span>
          <span>Confidence {Math.round(relation.confidence * 100)}%</span>
        </div>
        {relation.reasoning && <p className="mt-2 text-xs leading-5 text-ink/70">{relation.reasoning}</p>}
        <div className="mt-3 space-y-2">
          {relation.evidence.map((evidence, index) => (
            <figure className="rounded-lg bg-ink/5 p-2.5" key={`${evidence.articleId}:${evidence.startOffset ?? index}`}>
              <figcaption className="mb-1 text-[10px] font-bold text-ink/45">
                {articleById.get(evidence.articleId)?.title ?? evidence.articleId}
                {evidence.supportScore !== undefined && ` · support ${Math.round(evidence.supportScore * 100)}%`}
              </figcaption>
              <blockquote className="text-xs leading-5 text-ink/70">“{evidence.quote}”</blockquote>
            </figure>
          ))}
        </div>
        <button className="mt-3 text-xs font-bold text-coral hover:underline" onClick={() => onSelect(related.id)} type="button">
          查看 {related.name} →
        </button>
      </div>
    </details>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white/45 p-3">
      <strong className="font-display text-2xl">{value}</strong>
      <p className="text-[10px] font-bold tracking-wider text-ink/40 uppercase">{label}</p>
    </div>
  );
}

function RelationCard({
  title,
  subtitle,
  concepts,
  onSelect,
}: {
  title: string;
  subtitle: string;
  concepts: Concept[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="panel p-5">
      <p className="eyebrow">{title}</p>
      <h3 className="mt-1 font-display text-xl font-semibold">{subtitle}</h3>
      <div className="mt-4 flex flex-wrap gap-2">
        {concepts.length ? concepts.map((concept) => (
          <button className="concept-pill" key={concept.id} onClick={() => onSelect(concept.id)} type="button">
            <span className="size-2 rounded-full" style={{ background: domainColors[concept.domain] }} />
            {concept.name}
          </button>
        )) : <span className="text-sm text-ink/45">这是一个起点概念。</span>}
      </div>
    </div>
  );
}

function KnowledgeGraph({
  data,
  selected,
  onSelect,
}: {
  data: CompiledKnowledgeDataset;
  selected: Concept;
  onSelect: (id: string) => void;
}) {
  const nodes = data.concepts;
  const positions = new Map(
    nodes.map((concept, index) => [
      concept.id,
      { x: 58 + (index % 3) * 116, y: 45 + Math.floor(index / 3) * 77 },
    ]),
  );
  const edges = data.relations.filter((relation) => relation.kind !== "article-concept");

  return (
    <svg aria-label="概念关系图" className="h-[390px] w-full" role="img" viewBox="0 0 350 390">
      {edges.map((edge) => {
        const source = positions.get(edge.sourceId);
        const target = positions.get(edge.targetId);
        if (!source || !target) return null;
        return (
          <line
            className={edge.kind === "prerequisite" ? "graph-edge-prerequisite" : "graph-edge-related"}
            key={edge.id}
            x1={source.x}
            x2={target.x}
            y1={source.y}
            y2={target.y}
          />
        );
      })}
      {nodes.map((concept) => {
        const position = positions.get(concept.id)!;
        const active = concept.id === selected.id;
        return (
          <g
            aria-label={`查看概念 ${concept.name}`}
            className="graph-node"
            key={concept.id}
            onClick={() => onSelect(concept.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelect(concept.id);
            }}
            role="button"
            tabIndex={0}
            transform={`translate(${position.x} ${position.y})`}
          >
            <circle
              fill={active ? domainColors[concept.domain] : "#ffffff"}
              r={active ? 25 : 19}
              stroke={active ? "#0066ff" : domainColors[concept.domain]}
              strokeWidth={active ? 3 : 2}
            />
            <text className={active ? "graph-label graph-label-active" : "graph-label"} textAnchor="middle" y={active ? 39 : 32}>
              {concept.name.length > 7 ? `${concept.name.slice(0, 7)}…` : concept.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
