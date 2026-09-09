import type { ReactElement } from "react";
import type { Relation } from "@/data/models";

/**
 * 知识图谱画布的输入输出契约。
 *
 * 分工：architect 定义这份契约，knowledge-space-agent 实现渲染。
 * 技术选型（@xyflow/react / D3 / 手写 SVG）由 knowledge-space-agent 决定，
 * 但不得改动这里的 props 形状——否则上游 feature 会跟着一起改。
 *
 * 布局坐标不进契约：节点位置由画布内部算，调用方只给数据。
 */

export interface GraphNode {
  id: string;
  /** 概念名，显示为节点标签。 */
  name: string;
  /** 所属领域，决定节点配色。 */
  domain: string;
  /** 基础/进阶/高级，可映射到节点半径。 */
  level: "foundation" | "intermediate" | "advanced";
  /** 置信度 [0,1]。 */
  confidence: number;
  /** 提到该概念的文章数，暗示概念的分量。 */
  articleCount: number;
}

export interface GraphEdge {
  id: string;
  kind: Relation["kind"];
  sourceId: string;
  targetId: string;
  confidence: number;
  /** 该关系的原文引文，点开边时展示；空数组表示没有可展示的证据。 */
  evidenceQuotes: string[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphCanvasProps {
  data: GraphData;
  /** 当前聚焦的概念 id：画布高亮它与它的邻边，其余降透明度。 */
  selectedNodeId?: string;
  /** 只显示这些领域；undefined 表示不筛选。 */
  visibleDomains?: string[];
  /** 需要高亮为「新增」的节点 id（增量编译回到空间时用）。 */
  highlightedNodeIds?: string[];
  /** 点击节点：知识空间用它打开概念详情。 */
  onNodeSelect?: (nodeId: string) => void;
  /** 点击边：用于展开证据引文。 */
  onEdgeSelect?: (edgeId: string) => void;
}

/** 画布组件的签名。knowledge-space-agent 提供符合它的实现。 */
export type GraphCanvasComponent = (props: GraphCanvasProps) => ReactElement;
