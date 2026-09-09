"use client";

import type { GraphCanvasProps } from "@/lib/frontend/graph";

/**
 * 图谱画布占位实现。
 *
 * OWNER: knowledge-space-agent
 *
 * 技术选型故意留空：@xyflow/react、D3、手写 SVG 都行，由 knowledge-space-agent 决定。
 * architect 只固定 props 形状（lib/frontend/graph.ts 的 GraphCanvasProps），
 * 这样上游页面不用等图谱实现完就能先搭布局。
 *
 * 约束：布局与渲染细节全部留在 app/space/graph/** 内部，不要外泄到调用方。
 * 调用方只给 GraphData 和回调，不传坐标、不传缩放状态。
 *
 * 当前只回显数据规模与领域图例，用来证明 buildGraphData 的投影是通的。
 */
export function GraphCanvas({
  data,
  selectedNodeId,
  visibleDomains,
  highlightedNodeIds,
  onNodeSelect,
}: GraphCanvasProps) {
  const visible = visibleDomains?.length
    ? data.nodes.filter((node) => visibleDomains.includes(node.domain))
    : data.nodes;
  const visibleIds = new Set(visible.map(({ id }) => id));
  const edges = data.edges.filter(
    (edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId),
  );
  const highlighted = new Set(highlightedNodeIds ?? []);

  return (
    <div className="grid min-h-[320px] place-items-center rounded-xl border border-dashed border-ink/15 bg-white p-6">
      <div className="text-center">
        <p className="eyebrow">Graph Canvas · 未实现</p>
        <p className="mt-2 font-mono text-xs text-ink/45">
          {visible.length} nodes · {edges.length} edges
        </p>

        {/* 概念按钮：先让点击链路可测，正式实现会换成图节点。 */}
        <div className="mt-5 flex max-w-xl flex-wrap justify-center gap-1.5">
          {visible.slice(0, 12).map((node) => (
            <button
              className={`concept-pill ${
                node.id === selectedNodeId ? "border-coral text-coral" : ""
              } ${highlighted.has(node.id) ? "border-[#B26A2E]" : ""}`}
              key={node.id}
              onClick={() => onNodeSelect?.(node.id)}
              type="button"
            >
              {node.name}
              <span className="font-mono text-[9px] text-ink/35">{node.articleCount}</span>
            </button>
          ))}
          {visible.length > 12 && (
            <span className="self-center font-mono text-[10px] text-ink/35">
              +{visible.length - 12}
            </span>
          )}
        </div>

        <p className="mt-5 text-[11px] leading-5 text-ink/40">
          由 knowledge-space-agent 实现：星区聚类、桥梁连线、缩放平移、
          <br />
          点开边看证据句、新增节点高亮
        </p>
      </div>
    </div>
  );
}
