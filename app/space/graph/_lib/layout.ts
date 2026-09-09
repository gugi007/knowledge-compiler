import type { GraphNode } from "@/lib/frontend/graph";

/**
 * 画布内部布局（力导近似，不引新依赖）。
 *
 * OWNER: knowledge-space-agent
 *
 * 契约约束：布局坐标不进 GraphCanvasProps，也不外泄到调用方——
 * 这份模块只被 graph-canvas.tsx 引用。
 *
 * 算法：按 domain 分簇的圆环布局。
 * - 每个领域是一簇「星区」，簇心均匀分布在大圆轨道上；
 * - 簇内概念排小圆环，证据文章多的（分量重）沉入内环，形成簇核；
 * - 单一领域时退化为一个大同心圆。
 * 选择圆环而不是真力导：结果确定（同一数据两次渲染坐标完全一致），
 * 不需要迭代动画，几十 KB 的产物规模下视觉足够清楚。
 */

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 600;

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface ClusterPlacement {
  domain: string;
  /** 簇标签的文字锚点（簇上方），画布据此写领域名。 */
  label: LayoutPoint;
}

export interface GraphLayout {
  positions: Map<string, LayoutPoint>;
  clusters: ClusterPlacement[];
}

export function computeLayout(nodes: readonly GraphNode[]): GraphLayout {
  // 按 domain 分桶；桶序 = 领域在 nodes 里的首次出现顺序。
  // buildGraphData 的输出顺序是确定的，因此布局也确定，不会逐帧抖动。
  const buckets: { domain: string; nodes: GraphNode[] }[] = [];
  const byDomain = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    let bucket = byDomain.get(node.domain);
    if (!bucket) {
      bucket = [];
      byDomain.set(node.domain, bucket);
      buckets.push({ domain: node.domain, nodes: bucket });
    }
    bucket.push(node);
  }

  const positions = new Map<string, LayoutPoint>();
  const clusters: ClusterPlacement[] = [];
  if (buckets.length === 0) return { positions, clusters };

  const center = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };

  if (buckets.length === 1) {
    const cluster = buckets[0]!;
    clusters.push({ domain: cluster.domain, label: { x: center.x, y: 26 } });
    const radius = Math.min(230, 70 + cluster.nodes.length * 12);
    placeCluster(cluster.nodes, center, radius, positions);
    return { positions, clusters };
  }

  // 多领域：簇心在大圆轨道上均分。轨道半径留出簇自身半径 + 标签的余量，
  // 保证外围节点与文字不出画布。
  const orbit = Math.min(center.x, center.y) - 120;
  buckets.forEach((cluster, index) => {
    const angle = ((-90 + (index * 360) / buckets.length) * Math.PI) / 180;
    const clusterCenter = {
      x: center.x + orbit * Math.cos(angle),
      y: center.y + orbit * Math.sin(angle),
    };
    const ringRadius = Math.min(95, 30 + cluster.nodes.length * 8);
    clusters.push({
      domain: cluster.domain,
      label: { x: clusterCenter.x, y: clusterCenter.y - ringRadius - 14 },
    });
    placeCluster(cluster.nodes, clusterCenter, ringRadius, positions);
  });
  return { positions, clusters };
}

/** 一簇节点：重的（articleCount 大）沉内环，其余排外环。 */
function placeCluster(
  nodes: readonly GraphNode[],
  center: LayoutPoint,
  ringRadius: number,
  positions: Map<string, LayoutPoint>,
): void {
  const sorted = [...nodes].sort(
    (a, b) => b.articleCount - a.articleCount || a.id.localeCompare(b.id),
  );
  if (sorted.length === 1) {
    // 单概念簇直接放簇心，避免孤零零挂在环上。
    positions.set(sorted[0]!.id, { ...center });
    return;
  }
  const innerCount = sorted.length >= 6 ? Math.ceil(sorted.length / 3) : 0;
  placeRing(sorted.slice(0, innerCount), center, ringRadius * 0.52, positions);
  placeRing(sorted.slice(innerCount), center, ringRadius, positions);
}

function placeRing(
  nodes: readonly GraphNode[],
  center: LayoutPoint,
  radius: number,
  positions: Map<string, LayoutPoint>,
): void {
  nodes.forEach((node, index) => {
    const angle = ((-90 + (index * 360) / nodes.length) * Math.PI) / 180;
    positions.set(node.id, {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  });
}
