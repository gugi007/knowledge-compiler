"use client";

import { useCallback, useMemo, useState } from "react";
import type { CompiledKnowledgeDataset, Concept } from "@/data/models";
import { useActiveDataset } from "@/app/_shared/hooks/use-active-dataset";
import { PageShell } from "@/app/_shared/ui/page-shell";
import {
  buildGraphData,
  conceptsByDomain,
  domains,
  PATH_LEVEL_LABELS,
  summarize,
} from "@/lib/frontend/dataset";
import { ConceptCard } from "./concept-card";
import { absorbedInto, EditBar, type ConceptEdit, type EditMap } from "./edit-mode";
import { domainColorMap, DOMAIN_FALLBACK } from "./graph/_lib/domain-colors";
import { GraphCanvas } from "./graph/graph-canvas";
import { TimelinePlayer, type TimelineState } from "./timeline-player";

export function SpaceView() {
  const { dataset, corpus, resolved } = useActiveDataset();
  const [selectedDomain, setSelectedDomain] = useState<string>();
  const [selectedConceptId, setSelectedConceptId] = useState<string>();
  const [selectedPathId, setSelectedPathId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<EditMap>(new Map());
  const [cursor, setCursor] = useState(-1);
  const [timeline, setTimeline] = useState<TimelineState>();

  const summary = useMemo(() => summarize(dataset), [dataset]);
  const groups = useMemo(() => conceptsByDomain(dataset), [dataset]);
  const allDomains = useMemo(() => domains(dataset), [dataset]);
  const colors = useMemo(() => domainColorMap(allDomains), [allDomains]);

  const absorbed = useMemo(() => absorbedInto(edits), [edits]);
  const displayConcepts = useMemo(
    () =>
      dataset.concepts
        .filter((concept) => !edits.get(concept.id)?.deleted && !absorbed.has(concept.id))
        .map((concept) => {
          const edit = edits.get(concept.id);
          if (!edit) return concept;
          return {
            ...concept,
            name: edit.renamedTo ?? concept.name,
            summary: edit.summaryOverride ?? concept.summary,
          };
        }),
    [dataset.concepts, edits, absorbed],
  );

  const graphDataset = useMemo<CompiledKnowledgeDataset>(
    () => ({ ...dataset, concepts: displayConcepts }),
    [dataset, displayConcepts],
  );
  const graph = useMemo(() => buildGraphData(graphDataset), [graphDataset]);

  const selected: Concept | undefined = selectedConceptId
    ? displayConcepts.find(({ id }) => id === selectedConceptId)
    : undefined;
  const effectiveSelectedId = selected ? selectedConceptId : undefined;

  const activePath = selectedPathId
    ? dataset.readingPaths.find(({ id }) => id === selectedPathId)
    : undefined;
  const playing = cursor >= 0;
  const graphVisibleDomains = selectedDomain ? [selectedDomain] : undefined;

  const playbackGraph = useMemo(() => {
    if (!playing || !timeline) return graph;
    const revealed = new Set(timeline.revealedIds);
    return {
      nodes: graph.nodes.filter((node) => revealed.has(node.id)),
      edges: graph.edges.filter(
        (edge) => revealed.has(edge.sourceId) && revealed.has(edge.targetId),
      ),
    };
  }, [graph, playing, timeline]);

  const highlightedIds = playing ? timeline?.freshIds : undefined;
  const onTimelineChange = useCallback((state: TimelineState) => setTimeline(state), []);
  const applyEdit = useCallback((id: string, edit: ConceptEdit) => {
    setEdits((previous) => {
      const next = new Map(previous);
      next.set(id, edit);
      return next;
    });
  }, []);

  const editCount = edits.size;

  return (
    <PageShell
      actions={
        <button
          className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
            editing
              ? "bg-coral text-white hover:bg-[#004bbb]"
              : "border border-ink/15 text-ink/60 hover:border-coral hover:text-coral"
          }`}
          onClick={() => setEditing((value) => !value)}
          type="button"
        >
          {editing ? `退出编辑${editCount ? ` · ${editCount} 处改动` : ""}` : "编辑模式"}
        </button>
      }
      eyebrow="Act 3 · 知识空间"
    >
      <section className="panel hero-gradient mt-3 px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-coral font-display text-base font-bold text-white ring-2 ring-coral/15">
              {dataset.creator.name[0]}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h1 className="font-display text-xl font-semibold">{dataset.creator.name}</h1>
                <span className="text-xs text-ink/45">{dataset.creator.handle}</span>
                <span className="text-xs text-ink/35">· {corpus?.label ?? "本次编译产物"}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink/55">{dataset.creator.bio}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-[10px] text-ink/45">
            <span className="flex items-center gap-1.5 font-bold">
              <span className="status-dot" aria-hidden />
              {resolved ? "生长中" : "载入中"}
            </span>
            <span className="rounded-full border border-ink/10 bg-white/75 px-2 py-1 font-mono">
              {summary.articles} articles
            </span>
            <span className="rounded-full border border-ink/10 bg-white/75 px-2 py-1 font-mono">
              {summary.concepts} concepts
            </span>
            <span className="rounded-full border border-ink/10 bg-white/75 px-2 py-1 font-mono">
              {summary.conceptRelations} relations
            </span>
          </div>
        </div>
      </section>

      <div className="scrollbar mt-3 flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          className={`concept-pill shrink-0 ${selectedDomain === undefined ? "border-coral text-coral" : ""}`}
          onClick={() => setSelectedDomain(undefined)}
          type="button"
        >
          全部
        </button>
        {groups.map(({ domain, concepts }) => (
          <button
            className={`concept-pill shrink-0 ${selectedDomain === domain ? "border-coral text-coral" : ""}`}
            key={domain}
            onClick={() => setSelectedDomain(domain === selectedDomain ? undefined : domain)}
            type="button"
          >
            <i
              aria-hidden
              className="inline-block size-1.5 rounded-full"
              style={{ background: colors.get(domain) ?? DOMAIN_FALLBACK }}
            />
            {domain}
            <span className="font-mono text-[9px] text-ink/35">{concepts.length}</span>
          </button>
        ))}
        {!editing && dataset.readingPaths.length > 0 && (
          <>
            <span className="mx-1 h-5 w-px shrink-0 bg-ink/10" />
            {dataset.readingPaths.map((path) => (
              <button
                className={`concept-pill shrink-0 ${selectedPathId === path.id ? "border-coral text-coral" : ""}`}
                key={path.id}
                onClick={() => setSelectedPathId(selectedPathId === path.id ? undefined : path.id)}
                type="button"
              >
                {path.title}
              </button>
            ))}
          </>
        )}
      </div>

      <TimelinePlayer
        cursor={cursor}
        dataset={dataset}
        onChange={onTimelineChange}
        setCursor={setCursor}
      />

      {activePath && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-coral/20 bg-white/70 px-3 py-2 text-[11px] font-bold text-coral">
          <span aria-hidden>✦</span>
          正在沿「{activePath.title}」浏览
          <button
            className="ml-auto text-ink/40 hover:text-coral"
            onClick={() => setSelectedPathId(undefined)}
            type="button"
          >
            退出路径 ✕
          </button>
        </div>
      )}

      <div
        className={`mt-3 grid items-start gap-3 ${
          editing
            ? "lg:grid-cols-[220px_minmax(0,1fr)_320px]"
            : "lg:grid-cols-[minmax(0,1fr)_320px]"
        }`}
      >
        {editing && (
          <aside className="panel hidden max-h-[72vh] overflow-y-auto p-3 lg:block">
            <p className="eyebrow">编辑导航</p>
            <div className="mt-3 grid gap-1">
              {groups.map(({ domain, concepts }) => (
                <button
                  className={`concept-link ${selectedDomain === domain ? "concept-link-active" : ""}`}
                  key={domain}
                  onClick={() => setSelectedDomain(domain === selectedDomain ? undefined : domain)}
                  type="button"
                >
                  <span className="truncate">{domain}</span>
                  <span className="font-mono text-[10px]">{concepts.length}</span>
                </button>
              ))}
            </div>

            <p className="eyebrow mt-5">阅读路径</p>
            <div className="mt-2 grid gap-2">
              {dataset.readingPaths.map((path) => (
                <button
                  className={`reading-path text-left ${selectedPathId === path.id ? "!border-coral" : ""}`}
                  key={path.id}
                  onClick={() => setSelectedPathId(selectedPathId === path.id ? undefined : path.id)}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-ink/75">{path.title}</span>
                    <span className="rounded-full bg-ink px-1.5 py-0.5 text-[8px] font-bold text-paper uppercase">
                      {PATH_LEVEL_LABELS[path.level]}
                    </span>
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 text-ink/45">{path.summary}</span>
                </button>
              ))}
            </div>
          </aside>
        )}

        <section className="min-w-0">
          <GraphCanvas
            data={playbackGraph}
            highlightedNodeIds={highlightedIds}
            onNodeSelect={setSelectedConceptId}
            selectedNodeId={effectiveSelectedId}
            visibleDomains={graphVisibleDomains}
          />
        </section>

        <aside className="panel scrollbar hidden max-h-[72vh] self-start overflow-y-auto p-4 lg:sticky lg:top-3 lg:block">
          <p className="eyebrow">概念档案</p>
          {selected ? (
            <div className="mt-3">
              <ConceptCard
                concept={selected}
                dataset={graphDataset}
                headerSlot={
                  editing ? (
                    <div className="mt-4">
                      <EditBar
                        allConcepts={displayConcepts}
                        concept={selected}
                        edit={edits.get(selected.id)}
                        onApply={applyEdit}
                        onMerged={(_from, into) => setSelectedConceptId(into)}
                      />
                    </div>
                  ) : undefined
                }
                onSelectConcept={setSelectedConceptId}
              />
            </div>
          ) : (
            <p className="mt-3 text-left text-xs leading-5 text-ink/45">
              点击画布中的一个概念查看它的档案：观点演变、关系网络与原文证据。
            </p>
          )}
        </aside>
      </div>

      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
          <div
            aria-hidden
            className="fixed inset-0 bg-ink/30"
            onClick={() => setSelectedConceptId(undefined)}
          />
          <div className="panel scrollbar relative max-h-[72vh] overflow-y-auto rounded-t-2xl p-4">
            <ConceptCard
              concept={selected}
              dataset={graphDataset}
              headerSlot={
                editing ? (
                  <div className="mt-4">
                    <EditBar
                      allConcepts={displayConcepts}
                      concept={selected}
                      edit={edits.get(selected.id)}
                      onApply={applyEdit}
                      onMerged={(_from, into) => setSelectedConceptId(into)}
                    />
                  </div>
                ) : undefined
              }
              onClose={() => setSelectedConceptId(undefined)}
              onSelectConcept={setSelectedConceptId}
            />
          </div>
        </div>
      )}
    </PageShell>
  );
}
