/**
 * 领域配色。
 *
 * OWNER: knowledge-space-agent
 *
 * 画布节点、左栏领域图例、概念档案卡都要用同一套颜色，因此配色函数放在
 * graph/** 里由三处共用。注意：这是纯展示约定，不属于 GraphCanvasProps
 * 契约——契约里没有颜色，调用方也不需要知道。
 *
 * 为什么按「排序后的领域名」分配颜色：两个调用方拿到的领域顺序不同
 * （conceptsByDomain 按组大小排序，画布按节点出现顺序），只有以排序序
 * 为锚，同一领域在两处才保证同色。
 */

export const DOMAIN_PALETTE = [
  "#0066ff", // 蓝
  "#12a182", // 绿
  "#f07b3f", // 橙
  "#7c6cff", // 紫
  "#d6457f", // 洋红
  "#2f9e44", // 深绿
  "#e8590c", // 深橙
  "#1c7ed6", // 天蓝
] as const;

/** 领域数超过调色板长度、或领域缺失时的兜底灰。 */
export const DOMAIN_FALLBACK = "#9aa0a6";

export function domainColorMap(domains: readonly string[]): Map<string, string> {
  const sorted = [...new Set(domains)].sort((a, b) => a.localeCompare(b));
  const colors = new Map<string, string>();
  sorted.forEach((domain, index) => {
    colors.set(domain, DOMAIN_PALETTE[index % DOMAIN_PALETTE.length] ?? DOMAIN_FALLBACK);
  });
  return colors;
}
