"use client";

import { useMemo, useState } from "react";
import type { GraphCanvasProps, GraphEdge, GraphNode } from "@/lib/frontend/graph";
import { RELATION_LABELS } from "@/lib/frontend/dataset";
import { domainColorMap, DOMAIN_FALLBACK } from "./_lib/domain-colors";
import { CANVAS_HEIGHT, CANVAS_WIDTH, computeLayout } from "./_lib/layout";

const EDGE_CLASS: Record<string, string> = {
  prerequisite: "graph-edge-prerequisite",
  related: "graph-edge-related",
  extends: "graph-edge-related",
};

function edgeStroke(kind: string, active: boolean): string {
  if (kind === "prerequisite") return active ? "#0066ff" : "rgb(0 102 255 / 35%)";
  if (kind === "extends") return active ? "#f07b3f" : "rgb(240 123 63 / 35%)";
  return active ? "rgb(18 18 18 / 40%)" : "rgb(18 18 18 / 14%)";
}

function nodeRadius(node: GraphNode): number {
  return Math.min(30, 16 + node.articleCount * 2);
}

export function GraphCanvas({
  data,
  selectedNodeId,
  visibleDomains,
  highlightedNodeIds,
  onNodeSelect,
  onEdgeSelect,
}: GraphCanvasProps) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<{ px: number; py: number } | null>(null);

  const colors = useMemo(
    () => domainColorMap(data.nodes.map((node) => node.domain)),
    [data.nodes],
  );

  const visible = visibleDomains?.length
    ? data.nodes.filter((node) => visibleDomains.includes(node.domain))
    : data.nodes;
  const visibleIds = useMemo(() => new Set(visible.map(({ id }) => id)), [visible]);
  const edges = data.edges.filter(
    (edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId),
  );
  const layout = useMemo(() => computeLayout(visible), [visible]);
  const highlighted = useMemo(() => new Set(highlightedNodeIds ?? []), [highlightedNodeIds]);

  const focusEdgeIds = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const ids = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId) ids.add(edge.id);
    }
    return ids;
  }, [edges, selectedNodeId]);

  const selectedEdge: GraphEdge | undefined = selectedEdgeId
    ? edges.find(({ id }) => id === selectedEdgeId)
    : undefined;

  const domainLegend = useMemo(() => {
    const seen = new Map<string, number>();
    for (const node of visible) seen.set(node.domain, (seen.get(node.domain) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {domainLegend.map(([domain, count]) => (
            <span className="flex items-center gap-1 text-[10px] font-bold text-ink/45" key={domain}>
              <i
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{ background: colors.get(domain) ?? DOMAIN_FALLBACK }}
              />
              {domain}
              <span className="font-mono text-ink/30">{count}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 hidden text-[9px] font-medium text-ink/35 xl:inline">Ctrl/⌘ + 滚轮缩放</span>
          <button
            aria-label="缩小"
            className="grid size-7 place-items-center rounded-md border border-ink/10 text-xs font-bold text-ink/55 hover:border-coral hover:text-coral"
            onClick={() => setView((v) => ({ ...v, k: Math.max(0.5, v.k / 1.2) }))}
            type="button"
          >
            −
          </button>
          <button
            aria-label="重置视图"
            className="grid h-7 place-items-center rounded-md border border-ink/10 px-2 text-[10px] font-bold text-ink/55 hover:border-coral hover:text-coral"
            onClick={() => setView({ x: 0, y: 0, k: 1 })}
            type="button"
          >
            重置
          </button>
          <button
            aria-label="放大"
            className="grid size-7 place-items-center rounded-md border border-ink/10 text-xs font-bold text-ink/55 hover:border-coral hover:text-coral"
            onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))}
            type="button"
          >
            +
          </button>
        </div>
      </div>

      <svg
        aria-label="知识图谱画布"
        className="block h-[58vh] min-h-[500px] w-full select-none md:h-[66vh] xl:h-[72vh]"
        onMouseDown={(event) => {
          if ((event.target as Element).closest(".graph-node, .graph-edge-hit")) return;
          setDrag({ px: event.clientX - view.x, py: event.clientY - view.y });
        }}
        onMouseLeave={() => setDrag(null)}
        onMouseMove={(event) => {
          if (!drag) return;
          setView((v) => ({ ...v, x: event.clientX - drag.px, y: event.clientY - drag.py }));
        }}
        onMouseUp={() => setDrag(null)}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          const factor = event.deltaY > 0 ? 1 / 1.12 : 1.12;
          setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.5, v.k * factor)) }));
        }}
        role="application"
        style={{ cursor: drag ? "grabbing" : "grab" }}
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.clusters.map(({ domain, label }) => (
            <text
              className="fill-ink/35 font-mono text-[11px] font-bold tracking-widest uppercase"
              key={domain}
              textAnchor="middle"
              x={label.x}
              y={label.y}
            >
              {domain}
            </text>
          ))}

          {edges.map((edge) => {
            const source = layout.positions.get(edge.sourceId);
            const target = layout.positions.get(edge.targetId);
            if (!source || !target) return null;
            const active = selectedEdgeId === edge.id;
            const dimmed = focusEdgeIds !== undefined && !focusEdgeIds.has(edge.id) && !active;
            return (
              <g key={edge.id}>
                <line
                  className={EDGE_CLASS[edge.kind] ?? "graph-edge-related"}
                  opacity={dimmed ? 0.12 : 1}
                  stroke={edgeStroke(edge.kind, active)}
                  strokeDasharray={edge.kind === "related" ? "4 4" : undefined}
                  strokeWidth={active ? 2.6 : undefined}
                  x1={source.x}
                  x2={target.x}
                  y1={source.y}
                  y2={target.y}
                />
                <line
                  className="graph-edge-hit"
                  onClick={() => {
                    setSelectedEdgeId(active ? undefined : edge.id);
                    onEdgeSelect?.(edge.id);
                  }}
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: "pointer" }}
                  x1={source.x}
                  x2={target.x}
                  y1={source.y}
                  y2={target.y}
                />
              </g>
            );
          })}

          {visible.map((node) => {
            const point = layout.positions.get(node.id);
            if (!point) return null;
            const active = node.id === selectedNodeId;
            const isNew = highlighted.has(node.id);
            const dimmed = selectedNodeId !== undefined && !active &&
              !edges.some(
                (edge) =>
                  focusEdgeIds?.has(edge.id) &&
                  (edge.sourceId === node.id || edge.targetId === node.id),
              );
            const radius = nodeRadius(node);
            const color = colors.get(node.domain) ?? DOMAIN_FALLBACK;
            return (
              <g
                aria-label={`查看概念 ${node.name}`}
                className="graph-node"
                key={node.id}
                onClick={() => onNodeSelect?.(node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onNodeSelect?.(node.id);
                  }
                }}
                opacity={dimmed ? 0.25 : 1}
                role="button"
                tabIndex={0}
                transform={`translate(${point.x} ${point.y})`}
              >
                {isNew && (
                  <circle
                    fill="none"
                    r={radius + 5}
                    stroke="#b26a2e"
                    strokeDasharray="3 3"
                    strokeWidth={1.5}
                  />
                )}
                <circle
                  fill={active ? color : "#ffffff"}
                  r={radius}
                  stroke={isNew ? "#b26a2e" : color}
                  strokeWidth={active ? 3 : 2}
                />
                {active && (
                  <circle cx={-radius * 0.35} cy={-radius * 0.35} fill="#ffffff" r={radius * 0.2} />
                )}
                <text
                  className={active ? "graph-label graph-label-active" : "graph-label"}
                  textAnchor="middle"
                  y={radius + 13}
                >
                  {node.name.length > 8 ? `${node.name.slice(0, 8)}…` : node.name}
                </text>
                {isNew && (
                  <text fill="#b26a2e" fontSize={8} fontWeight={800} textAnchor="middle" y={-radius - 8}>
                    NEW
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {selectedEdge && (
        <div className="border-t border-ink/10 bg-paper/60 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-bold text-ink/55">
              <span className="relation-kind mr-2">{RELATION_LABELS[selectedEdge.kind]}</span>
              证据引文 · 置信度 {Math.round(selectedEdge.confidence * 100)}%
            </p>
            <button
              aria-label="关闭证据"
              className="text-xs font-bold text-ink/40 hover:text-coral"
              onClick={() => setSelectedEdgeId(undefined)}
              type="button"
            >
              ✕
            </button>
          </div>
          {selectedEdge.evidenceQuotes.length ? (
            <ul className="mt-2 grid gap-1.5">
              {selectedEdge.evidenceQuotes.map((quote, index) => (
                <li className="rounded-lg bg-white px-3 py-2 text-xs leading-5 text-ink/65" key={index}>
                  “{quote}”
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink/40">这条关系没有可展示的原文引文。</p>
          )}
        </div>
      )}
    </div>
  );
}
