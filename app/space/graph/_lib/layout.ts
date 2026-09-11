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

/**
 * 画布坐标系尺寸。
 *
 * 放大到 1100×760 是为了让多领域语料的簇间距真正拉开：`preserveAspectRatio`
 * 是 meet（等比缩放），放大坐标系等于等比放大每一处尺度余量，而 960×600 的
 * 半高只有 300，装不下「轨道 235 + 簇半径 115 + 节点圆 26」而不切顶。
 */
export const CANVAS_WIDTH = 1100;
export const CANVAS_HEIGHT = 760;

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
    // 半高 380 减去簇标签的 14 还有 366，290 的环不会把概念或标签顶出画布。
    const radius = Math.min(290, 80 + cluster.nodes.length * 14);
    placeCluster(cluster.nodes, center, radius, positions);
    return { positions, clusters };
  }

  // 多领域：簇心在大圆轨道上均分。轨道半径留出簇自身半径 + 节点圆 + 标签的余量，
  // 保证外围节点与文字不出画布。
  // 145 = 簇半径上限 115 + 节点圆半径上限 26 + 4 余量，改 ringRadius 上限要同步改。
  // 约束来自**节点圆**而不是标签：环顶节点（placeRing 的 index 0 固定落在 -90°）
  // 圆心在 y = 簇心 - ringRadius，圆本身再占 26；只算标签的 14 会把顶部节点圆
  // 切掉 6px。
  const orbit = Math.min(center.x, center.y) - 145;
  buckets.forEach((cluster, index) => {
    const baseAngle = ((-90 + (index * 360) / buckets.length) * Math.PI) / 180;
    // 簇心不再严格均分：角度 ±12°、到中心距离 ±25px。四个象限仍可辨，
    // 但不再是正东南西北的钟表盘。
    const angle = baseAngle + hashNoise(`${cluster.domain}::a`) * (12 * Math.PI) / 180;
    const r = orbit + hashNoise(`${cluster.domain}::r`) * 25;
    const clusterCenter = {
      x: center.x + r * Math.cos(angle),
      y: center.y + r * Math.sin(angle),
    };
    const ringRadius = Math.min(115, 40 + cluster.nodes.length * 10);
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

/**
 * 确定性伪随机：djb2 变体，把字符串散成 [-1, 1]。
 * 用节点 id / 领域名做种子，同一数据两次渲染坐标完全一致——
 * 不引入逐帧抖动，只给严格圆环加一点「手推散」的呼吸感。
 */
function hashNoise(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const unit = ((h >>> 0) % 10000) / 10000;
  return unit * 2 - 1;
}

function placeRing(
  nodes: readonly GraphNode[],
  center: LayoutPoint,
  radius: number,
  positions: Map<string, LayoutPoint>,
): void {
  nodes.forEach((node, index) => {
    const baseAngle = ((-90 + (index * 360) / nodes.length) * Math.PI) / 180;
    // 角度 ±8.6°、半径 ±12px：圆环不再是尺子量过的正圆，但节点间距 ~140px，
    // 这点抖动完全不会让两个节点撞上。
    const angle = baseAngle + hashNoise(`${node.id}::a`) * 0.15;
    const r = radius + hashNoise(`${node.id}::r`) * 12;
    positions.set(node.id, {
      x: center.x + r * Math.cos(angle),
      y: center.y + r * Math.sin(angle),
    });
  });
}
