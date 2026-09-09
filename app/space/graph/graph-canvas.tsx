"use client";

import { useMemo, useState } from "react";
import type { GraphCanvasProps, GraphEdge, GraphNode } from "@/lib/frontend/graph";
import { RELATION_LABELS } from "@/lib/frontend/dataset";
import { domainColorMap, DOMAIN_FALLBACK } from "./_lib/domain-colors";
import { CANVAS_HEIGHT, CANVAS_WIDTH, computeLayout } from "./_lib/layout";

/**
 * 图谱画布：手写 SVG，零新依赖。
 *
 * OWNER: knowledge-space-agent
 *
 * 契约边界：布局坐标在内部由 layout.ts 计算（确定性分簇圆环），
 * 缩放平移状态也在内部，GraphCanvasProps 不外泄任何渲染细节。
 *
 * 交互：
 * - 点击节点 → onNodeSelect；点击边 → onEdgeSelect（展开证据）
 * - 选中某节点后，其余节点与无关边降透明度聚焦
 * - highlightedNodeIds 以描边光圈标出（增量编译新增）
 * - 拖空白处平移，滚轮缩放（内部 state，不入契约）
 */

const EDGE_CLASS: Record<string, string> = {
  prerequisite: "graph-edge-prerequisite",
  related: "graph-edge-related",
  extends: "graph-edge-related",
};

/** 边的颜色统一走 CSS 类，但箭头 marker 需要按颜色区分的简化处理。 */
function edgeStroke(kind: string, active: boolean): string {
  if (kind === "prerequisite") return active ? "#0066ff" : "rgb(0 102 255 / 35%)";
  if (kind === "extends") return active ? "#f07b3f" : "rgb(240 123 63 / 35%)";
  return active ? "rgb(18 18 18 / 40%)" : "rgb(18 18 18 / 14%)";
}

function nodeRadius(node: GraphNode): number {
  // 分量（证据文章数）映射到半径，16~30。
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
  // 平移缩放：画布内部状态，调用方不知道也不该知道。
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

  // 选中节点时：邻接边保持高亮，其余淡出。
  const focusEdgeIds = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const ids = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId) {
        ids.add(edge.id);
      }
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
            <span
              className="flex items-center gap-1 text-[10px] font-bold text-ink/45"
              key={domain}
            >
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
        className="block h-[420px] w-full touch-none select-none md:h-[520px]"
        onMouseDown={(event) => {
          // 点在节点/边上时不进入平移。
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
          event.preventDefault();
          const next = Math.min(2.5, Math.max(0.5, view.k * (event.deltaY > 0 ? 1 / 1.12 : 1.12)));
          setView((v) => ({ ...v, k: next }));
        }}
        role="application"
        style={{ cursor: drag ? "grabbing" : "grab" }}
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* 簇标签：领域名悬浮在簇上方。 */}
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

          {/* 边。 */}
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
                {/* 加宽的透明命中区，细边不好点。 */}
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

          {/* 节点。 */}
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
                  <text
                    fill="#b26a2e"
                    fontSize={8}
                    fontWeight={800}
                    textAnchor="middle"
                    y={-radius - 8}
                  >
                    NEW
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* 选中边：在画布底部展开证据引文。 */}
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
                <li
                  className="rounded-lg bg-white px-3 py-2 text-xs leading-5 text-ink/65"
                  key={index}
                >
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
