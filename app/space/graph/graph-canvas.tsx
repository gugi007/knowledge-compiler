"use client";

import { useMemo, useState, type ReactNode } from "react";
import s from "@/app/space/space.module.css";
import type { GraphCanvasProps, GraphEdge, GraphNode } from "@/lib/frontend/graph";
import { RELATION_LABELS } from "@/lib/frontend/dataset";
import { domainColorMap, domainOrderOf, DOMAIN_FALLBACK } from "./_lib/domain-colors";
import { CANVAS_HEIGHT, CANVAS_WIDTH, computeLayout } from "./_lib/layout";

/**
 * 画布对外的扩展 props。
 *
 * 契约里（lib/frontend/graph.ts 的 GraphCanvasProps）只有「移除式筛选」的
 * visibleDomains；第三幕参考稿需要的是「变暗不删除」。这里用本地扩展类型吸收
 * 新增的渲染态，不改共享契约——批次 3 的调用方切过来之前，两套语义并存：
 * - visibleDomains：仍按旧行为把领域外的节点/边整个抽掉；
 * - dimmedDomains：保留节点，只把命中领域的节点压到 opacity .35。
 */
export type SpaceGraphProps = GraphCanvasProps & {
  /** 需要「变暗」的领域：节点保留但降透明度（不删除）。 */
  dimmedDomains?: readonly string[];
  /** 本次增量编译新增的节点 id：淡入 + 脉冲光环 + NEW 角标。 */
  newNodeIds?: readonly string[];
  /** 本次增量编译被改写的节点 id：挂 UPDATED 角标（绿色 #1E7E34）。 */
  updatedNodeIds?: readonly string[];
  /** 本次增量编译新增的边 id：淡入点亮。 */
  newEdgeIds?: readonly string[];
  /** 聚焦新增：非新增元素压到 opacity .18（挂在 stage 上的氛围态）。 */
  focusNew?: boolean;
  /** 编译进行中：非新增元素压到 opacity .5（挂在 stage 上的氛围态）。 */
  compiling?: boolean;
  /**
   * 画布内浮层：渲染在 `.stage` 内部（参考稿里 `.evo-fab` 就贴在 stage 左下角）。
   * 第三幕用它挂「知识演变」回放胶囊，位置因此跟着画布而不是浏览器视口走。
   */
  overlay?: ReactNode;
};

const CROSS_DOMAIN_STROKE = "#D8DCE3";

/** 领域色 → 8% alpha 的填充色（参考稿节点是极淡的领域色底 + 同色描边）。 */
function nodeFill(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map((char) => char + char).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return `rgb(133 144 166 / ${alpha})`;
  const value = Number.parseInt(full, 16);
  return `rgb(${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255} / ${alpha})`;
}

function nodeRadius(node: GraphNode): number {
  return Math.min(30, 16 + node.articleCount * 2);
}

function labelOf(name: string): string {
  return name.length > 8 ? `${name.slice(0, 8)}…` : name;
}

/** 只有布局/数据真为空时才需要，兜底一个合法的空集合。 */
const EMPTY: readonly string[] = [];

export function GraphCanvas({
  data,
  selectedNodeId,
  visibleDomains,
  highlightedNodeIds,
  onNodeSelect,
  onEdgeSelect,
  dimmedDomains,
  newNodeIds,
  updatedNodeIds,
  newEdgeIds,
  focusNew,
  compiling,
  overlay,
}: SpaceGraphProps) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<{ px: number; py: number } | null>(null);

  // 领域色按「领域首次出现序」发色，与左栏图例共用 domainOrderOf：
  // 两处若各自决定顺序，同一领域就会在画布和图例里不同色（历史 bug）。
  const colors = useMemo(() => domainColorMap(domainOrderOf(data.nodes)), [data.nodes]);

  // ---- 旧语义：visibleDomains 仍是「移除」，批次 3 才会换成 dimmedDomains ----
  const visible = visibleDomains?.length
    ? data.nodes.filter((node) => visibleDomains.includes(node.domain))
    : data.nodes;
  const visibleIds = useMemo(() => new Set(visible.map(({ id }) => id)), [visible]);
  const edges = data.edges.filter(
    (edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId),
  );
  const layout = useMemo(() => computeLayout(visible), [visible]);

  // ---- 新语义：dimmedDomains 只降透明度，节点继续留在画布上 ----
  const dimmedSet = useMemo(() => new Set(dimmedDomains ?? EMPTY), [dimmedDomains]);
  const newNodes = useMemo(() => new Set(newNodeIds ?? EMPTY), [newNodeIds]);
  const updatedNodes = useMemo(() => new Set(updatedNodeIds ?? EMPTY), [updatedNodeIds]);
  const newEdges = useMemo(() => new Set(newEdgeIds ?? EMPTY), [newEdgeIds]);

  // highlightedNodeIds 是批次 0 就有的「新增」提示，与 newNodeIds 取并集。
  const highlighted = useMemo(() => new Set(highlightedNodeIds ?? EMPTY), [highlightedNodeIds]);

  const nodeById = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes]);

  const focusEdgeIds = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const ids = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId) ids.add(edge.id);
    }
    return ids;
  }, [edges, selectedNodeId]);

  /** 选中概念的「自己 + 邻居」，用于把图面其余部分压暗。 */
  const focusNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedNodeId) return ids;
    ids.add(selectedNodeId);
    for (const edge of edges) {
      if (edge.sourceId === selectedNodeId) ids.add(edge.targetId);
      else if (edge.targetId === selectedNodeId) ids.add(edge.sourceId);
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

  const stageClass = [s.stage, compiling ? s.compiling : "", focusNew ? s.focusNew : ""]
    .filter(Boolean)
    .join(" ");

  const nodeSelector = s.gNode ? `.${s.gNode}` : "[data-graph-node]";
  const edgeHitSelector = `.${s.edgeHit}`;

  return (
    /* 中栏本体就是一个 flex 列：工具条固定 + .stage 靠 flex:1 撑满剩余高度
       （参考稿 .canvas-col / .stage 的规则；栏高由 .workspace 的 100vh-140px 给）。 */
    <div className={s.canvasPanel}>
      <div className={s.canvasToolbar}>
        <div className={s.legend}>
          {domainLegend.map(([domain, count]) => (
            <span
              className={dimmedSet.has(domain) ? `${s.legendItem} ${s.dim}` : s.legendItem}
              key={domain}
            >
              <i
                aria-hidden
                className={s.legendDot}
                style={{ background: colors.get(domain) ?? DOMAIN_FALLBACK }}
              />
              {domain}
              <span style={{ color: "var(--faint)", fontVariantNumeric: "tabular-nums" }}>
                {count}
              </span>
            </span>
          ))}
        </div>
        <div className={s.zoom}>
          <button
            aria-label="缩小"
            className={s.zoomBtn}
            onClick={() => setView((v) => ({ ...v, k: Math.max(0.5, v.k / 1.2) }))}
            type="button"
          >
            −
          </button>
          <span className={s.zoomPct}>{Math.round(view.k * 100)}%</span>
          <button
            aria-label="放大"
            className={s.zoomBtn}
            onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))}
            type="button"
          >
            +
          </button>
        </div>
      </div>

      {/* 不再给 stage 任何固定高度：.canvasPanel 是 flex 列、.stage 是 flex:1，
          画布因此随中栏栏高撑满（<lg 断点下 .stage 自己退化成 60vh / 52vh）。 */}
      <div className={stageClass}>
        <svg
          aria-label="知识图谱画布"
          className={s.stageSvg}
          onMouseDown={(event) => {
            if ((event.target as Element).closest(`${nodeSelector}, ${edgeHitSelector}`)) return;
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
          preserveAspectRatio="xMidYMid meet"
          role="application"
          style={{ cursor: drag ? "grabbing" : "grab" }}
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {layout.clusters.map(({ domain, label }) => (
              <text
                className={s.clusterLabel}
                key={domain}
                opacity={dimmedSet.has(domain) ? 0.55 : 1}
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
              const sourceNode = nodeById.get(edge.sourceId);
              const targetNode = nodeById.get(edge.targetId);
              const color = colors.get(sourceNode?.domain ?? "") ?? DOMAIN_FALLBACK;
              // 领域内边：实线、用领域色；跨领域边：灰色虚线。
              const intraDomain = sourceNode?.domain === targetNode?.domain;
              const active = selectedEdgeId === edge.id;
              const isNewEdge = newEdges.has(edge.id);
              const faded = focusEdgeIds !== undefined && !focusEdgeIds.has(edge.id) && !active;
              const opacity = faded ? 0.12 : intraDomain && !active ? 0.7 : active ? 1 : 0.85;
              return (
                <g key={edge.id}>
                  <line
                    className={isNewEdge ? `${s.edgeNew} ${s.on}` : undefined}
                    // 新增边靠 .edgeNew.on 的 CSS 控制显隐，行内 opacity 会压过类，
                    // 因此只在非新增边上用 opacity 属性做聚焦淡化。
                    opacity={isNewEdge ? undefined : opacity}
                    stroke={intraDomain || active ? color : CROSS_DOMAIN_STROKE}
                    strokeDasharray={intraDomain && !active ? undefined : "4 4"}
                    strokeWidth={active ? 2.4 : intraDomain ? 1.6 : 1.2}
                    x1={source.x}
                    x2={target.x}
                    y1={source.y}
                    y2={target.y}
                  />
                  <line
                    className={s.edgeHit}
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
              const isNew = newNodes.has(node.id) || highlighted.has(node.id);
              const isUpdated = !isNew && updatedNodes.has(node.id);
              const radius = nodeRadius(node);
              const color = colors.get(node.domain) ?? DOMAIN_FALLBACK;

              const focusFaded = selectedNodeId !== undefined && !focusNodeIds.has(node.id);
              const domainFaded = dimmedSet.has(node.domain);
              // 变暗不删除：命中 dimmedDomains 的节点保留在图面上，只压到 .35。
              const opacity = focusFaded ? 0.25 : domainFaded ? 0.35 : 1;

              const classes = [s.gNode];
              if (isNew) classes.push(s.newNode, s.on);

              return (
                <g
                  aria-label={`查看概念 ${node.name}`}
                  className={classes.join(" ")}
                  data-graph-node=""
                  key={node.id}
                  onClick={() => onNodeSelect?.(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onNodeSelect?.(node.id);
                    }
                  }}
                  // 新增节点由 .newNode.on 控制显隐，行内属性会被类压过，故不重复设置。
                  opacity={isNew ? undefined : opacity}
                  role="button"
                  tabIndex={0}
                  transform={`translate(${point.x} ${point.y})`}
                >
                  {isNew && (
                    <circle
                      className={s.halo}
                      fill="none"
                      r={radius}
                      stroke={color}
                      strokeWidth={1.5}
                    />
                  )}
                  {active && (
                    <circle
                      fill="none"
                      opacity={0.18}
                      r={radius + 10}
                      stroke={color}
                      strokeWidth={1}
                    />
                  )}
                  <circle
                    className={s.gBody}
                    fill={active ? color : nodeFill(color, 0.08)}
                    r={radius}
                    stroke={color}
                    strokeWidth={active ? 1.8 : 1.6}
                  />
                  <text
                    className={active ? `${s.gLabel} ${s.sel}` : s.gLabel}
                    textAnchor="middle"
                    y={radius + 13}
                  >
                    {labelOf(node.name)}
                  </text>
                  {isNew && (
                    <text
                      className={`${s.newTag} ${s.updated}`}
                      textAnchor="middle"
                      y={-radius - 8}
                    >
                      NEW
                    </text>
                  )}
                  {isUpdated && (
                    <text
                      className={s.updatedTag}
                      textAnchor="middle"
                      y={-radius - 8}
                    >
                      UPDATED
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* 参考稿的 .evo-fab 就落在 .stage 内部，所以画布内的浮层由这里承接。 */}
        {overlay}
      </div>

      {selectedEdge && (
        <div className={s.edgePanel}>
          <div className={s.edgePanelHead}>
            <p className={s.edgePanelTitle}>
              <span className={s.edgeKind}>{RELATION_LABELS[selectedEdge.kind]}</span>
              证据引文 · 置信度 {Math.round(selectedEdge.confidence * 100)}%
            </p>
            <button
              aria-label="关闭证据"
              className={s.edgeClose}
              onClick={() => setSelectedEdgeId(undefined)}
              type="button"
            >
              ✕
            </button>
          </div>
          {selectedEdge.evidenceQuotes.length ? (
            <ul className={s.edgeList}>
              {selectedEdge.evidenceQuotes.map((quote, index) => (
                <li className={s.edgeQuote} key={index}>
                  “{quote}”
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.edgeEmpty}>这条关系没有可展示的原文引文。</p>
          )}
        </div>
      )}
    </div>
  );
}
