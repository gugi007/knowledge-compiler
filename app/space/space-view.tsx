"use client";

import { useCallback, useMemo, useState } from "react";
import type { CompiledKnowledgeDataset, Concept } from "@/data/models";
import { useActiveDataset } from "@/app/_shared/hooks/use-active-dataset";
import { PageShell } from "@/app/_shared/ui/page-shell";
import { StatGrid } from "@/app/_shared/ui/stat-grid";
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

/**
 * 第三幕：知识空间。
 *
 * OWNER: knowledge-space-agent
 *
 * 布局：作者头 → 三栏（领域与路径 | 图谱画布 | 概念档案）→ 底部时间轴。
 * 窄屏（<lg）左右栏收起：领域筛选变顶部横条，档案卡变底部抽屉。
 *
 * 状态分层：
 * - 视图态：选中领域 / 选中概念 / 时间轴游标 / 编辑开关 —— 本组件持有
 * - 编辑态：EditMap（本地校对，未持久化，见 edit-mode.tsx 注释与架构 C4）
 * - 画布内部态：布局坐标与缩放平移都在 graph/**，不外泄
 *
 * 取数一律走 lib/frontend/dataset.ts 投影层；编辑覆盖只在展示层做
 * （displayConcepts），不改原始 dataset。
 */

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

  // ---- 编辑覆盖层：展示用概念列表 = 原始 - 删除 - 被合并走的 + 重命名/修正。
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

  // 编辑模式下的画布数据：以展示概念为准重新投影（关系保持原样，
  // 指向被删/被合并概念的边由 buildGraphData 的悬空过滤自然剔除）。
  const graphDataset = useMemo<CompiledKnowledgeDataset>(
    () => ({ ...dataset, concepts: displayConcepts }),
    [dataset, displayConcepts],
  );
  const graph = useMemo(() => buildGraphData(graphDataset), [graphDataset]);

  const selected: Concept | undefined = selectedConceptId
    ? displayConcepts.find(({ id }) => id === selectedConceptId)
    : undefined;

  // 选中的概念被删除或被合并走时，清空选中：不在 effect 里 setState，
  // 而是渲染期派生——selected 失效时画布/档案卡自然回落到未选中态，
  // selectedConceptId 本身留到下次交互再纠正，避免级联渲染。
  const effectiveSelectedId = selected ? selectedConceptId : undefined;

  // 阅读路径：当前高亮的路径，把它的概念序列按顺序连成「航线」。
  const activePath = selectedPathId
    ? dataset.readingPaths.find(({ id }) => id === selectedPathId)
    : undefined;
  const pathFocus = activePath ? new Set(activePath.conceptIds) : undefined;

  // 时间轴回放：revealedIds 非空时画布只显示已出现的概念；freshIds 高亮为新增。
  const playing = cursor >= 0;

  const graphVisibleDomains = selectedDomain ? [selectedDomain] : undefined;

  // 画布节点过滤（领域 + 回放 + 路径聚焦都以 visibleDomains/highlighted 表达，
  // 画布契约不需要知道「回放」这件事——用领域筛选与新增高亮两个既有通道组合）。
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

  const onTimelineChange = useCallback((state: TimelineState) => setTimeline(state), []);

  // 增量高亮：回放时高亮本篇新增；非回放时，上次编译新增由调用方经
  // highlightedNodeIds 传入——当前 useActiveDataset 不提供增量标记，
  // 因此这里只在回放时启用（见文末 CCR 说明）。
  const highlightedIds = playing ? timeline?.freshIds : undefined;

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
      {/* ===== 作者头 ===== */}
      <section className="panel hero-gradient mt-6 p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-full bg-coral font-display text-xl font-bold text-white ring-4 ring-coral/15">
              {dataset.creator.name[0]}
            </div>
            <div>
              <h1 className="font-display text-2xl font-semibold">{dataset.creator.name}</h1>
              <p className="mt-1 text-sm text-ink/55">
                {dataset.creator.handle} · {corpus?.label ?? "本次编译产物"}
              </p>
              <p className="mt-2 max-w-xl text-sm leading-6 text-ink/60">{dataset.creator.bio}</p>
              {dataset.creator.focus.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {dataset.creator.focus.map((domain) => (
                    <button
                      className="tag flex items-center gap-1.5 text-[11px] font-bold"
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
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="grid justify-items-end gap-2">
            <span className="flex items-center gap-2 text-[11px] font-bold text-ink/45">
              <span className="status-dot" aria-hidden />
              {resolved ? "生长中" : "载入中"}
            </span>
            <span className="rounded-full border border-ink/10 bg-white px-2.5 py-1 font-mono text-[10px] text-ink/45">
              {summary.mode === "mock" ? "deterministic mock" : summary.mode} · {summary.provider}
            </span>
          </div>
        </div>
        <div className="mt-5">
          <StatGrid
            items={[
              { label: "Articles", value: summary.articles },
              { label: "Concepts", value: summary.concepts },
              { label: "Relations", value: summary.conceptRelations },
              { label: "Domains", value: summary.domains },
            ]}
          />
        </div>
      </section>

      {/* ===== 窄屏（<lg）领域筛选横条 ===== */}
      <div className="scrollbar mt-4 flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
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
      </div>

      {/* ===== 三栏主体 ===== */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/* 左栏：领域 + 阅读路径（窄屏隐藏，领域筛选由上方横条承担）。 */}
        <aside className="panel hidden self-start p-4 lg:block">
          <p className="eyebrow">领域</p>
          <div className="mt-3 grid gap-1">
            <button
              className={`concept-link ${selectedDomain === undefined ? "concept-link-active" : ""}`}
              onClick={() => setSelectedDomain(undefined)}
              type="button"
            >
              全部
              <span className="font-mono text-[10px]">{summary.concepts}</span>
            </button>
            {groups.map(({ domain, concepts }) => (
              <button
                className={`concept-link ${selectedDomain === domain ? "concept-link-active" : ""}`}
                key={domain}
                onClick={() => setSelectedDomain(domain === selectedDomain ? undefined : domain)}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <i
                    aria-hidden
                    className="inline-block size-1.5 shrink-0 rounded-full"
                    style={{
                      background:
                        selectedDomain === domain
                          ? "#ffffff"
                          : (colors.get(domain) ?? DOMAIN_FALLBACK),
                    }}
                  />
                  <span className="truncate">{domain}</span>
                </span>
                <span className="font-mono text-[10px]">{concepts.length}</span>
              </button>
            ))}
          </div>

          <p className="eyebrow mt-6">阅读路径</p>
          <div className="mt-3 grid gap-2">
            {dataset.readingPaths.map((path) => {
              const active = path.id === selectedPathId;
              return (
                <button
                  className={`reading-path text-left transition-colors ${
                    active ? "!border-coral" : "hover:border-ink/25"
                  }`}
                  key={path.id}
                  onClick={() => setSelectedPathId(active ? undefined : path.id)}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs leading-4 font-bold text-ink/75">{path.title}</span>
                    <span className="shrink-0 rounded-full bg-ink px-1.5 py-0.5 text-[8px] font-bold tracking-wide text-paper uppercase">
                      {PATH_LEVEL_LABELS[path.level]}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-[11px] leading-4 text-ink/50">
                    {path.summary}
                  </span>
                  {/* 航线步骤：点击可逐个跳转概念。 */}
                  <span className="mt-2 flex items-center gap-0.5">
                    {path.conceptIds.map((conceptId, index) => (
                      <span className="flex items-center gap-0.5" key={conceptId}>
                        <span
                          className={`path-step !size-5 cursor-pointer text-[8px] ${
                            conceptId === effectiveSelectedId ? "path-step-active" : ""
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedConceptId(conceptId);
                          }}
                          role="button"
                          tabIndex={-1}
                          title={displayConcepts.find(({ id }) => id === conceptId)?.name}
                        >
                          {index + 1}
                        </span>
                        {index < path.conceptIds.length - 1 && (
                          <span className="text-[8px] text-ink/25">—</span>
                        )}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 画布。 */}
        <section className="min-w-0">
          {pathFocus && (
            <p className="mb-2 flex items-center gap-2 text-[11px] font-bold text-coral">
              <span aria-hidden>✦</span>
              正在沿「{activePath?.title}」浏览：路径上的概念保持高亮
              <button
                className="ml-auto text-ink/40 hover:text-coral"
                onClick={() => setSelectedPathId(undefined)}
                type="button"
              >
                退出路径 ✕
              </button>
            </p>
          )}
          <GraphCanvas
            data={playbackGraph}
            highlightedNodeIds={highlightedIds}
            onNodeSelect={setSelectedConceptId}
            selectedNodeId={effectiveSelectedId}
            visibleDomains={graphVisibleDomains}
          />
        </section>

        {/* 右栏：概念档案（宽屏常驻，窄屏改底部抽屉）。 */}
        <aside className="panel hidden self-start p-4 lg:block">
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
            <p className="mt-3 text-xs leading-5 text-ink/45">
              点击画布中的一个概念查看它的档案：观点演变、关系网络与原文证据。
            </p>
          )}
        </aside>
      </div>

      {/* ===== 时间轴回放 ===== */}
      <TimelinePlayer
        cursor={cursor}
        dataset={dataset}
        onChange={onTimelineChange}
        setCursor={setCursor}
      />

      {/* ===== 窄屏底部抽屉：概念档案 ===== */}
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
