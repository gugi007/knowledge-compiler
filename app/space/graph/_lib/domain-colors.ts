/**
 * 领域配色（单层：按领域首次出现序循环取色）。
 *
 * OWNER: knowledge-space-agent
 *
 * 画布节点、左栏领域图例、概念档案卡都要用同一套颜色，因此配色函数放在
 * graph/** 里由三处共用。注意：这是纯展示约定，不属于 GraphCanvasProps
 * 契约——契约里没有颜色，调用方也不需要知道。
 *
 * ── 规则 ─────────────────────────────────────────────────────
 * 领域名不再做任何身份映射，颜色 = 领域在数据里的**首次出现序**下标：
 * `CYCLE_PALETTE[position % 30]`。序号来自 domainOrderOf（见下），它是配色与
 * 画布簇序共用的唯一顺序。
 *
 * 为什么不做固定映射：未来要接入真实用户的文章，概念/领域规模会到「多到爆」，
 * 按概念名维护一张钉死表不现实——新语料永远会突破表外。按出现位置发色则对
 * 任意语料零硬编码自动生效。用户已明确：撞色无所谓，不为此做区分度最优化。
 *
 * ── 历史：当年那三个错位的领域，错在哪 ──────────────────────────
 * 配色曾经也是「按位置发色」，但当时的**位置不稳定**，于是同一个领域在不同
 * 视图里换色。实测症状：demo 语料四个领域错位三个——「推理系统」拿到紫色、
 * 「长上下文」拿到青绿、「注意力机制」拿到棕，只有「模型基础」恰好落在正确
 * 位置。三条成因：
 *   1. 两个调用点传进来的领域顺序不同：画布传节点出现序，左栏传
 *      `domains(dataset)`（按概念数降序，并用不传 locale 的 localeCompare
 *      打破平局，结果随运行环境漂移）；
 *   2. 于是「位置」在两次调用里根本不是同一个位置；
 *   3. 再叠上 localeCompare 的环境依赖，位置本身还会变。
 * 所以当年的错**不在「按位置发色」**，而在「顺序不稳定且两处不一致」。
 * 现在按位置发色是有意的设计，修的是顺序：单一来源 domainOrderOf、
 * 无排序、无 localeCompare、两个调用点共用同一入口。
 *
 * ── 本方案的设计代价（如实标注，不要粉饰）──────────────────────
 * 1. 领域集合一变，或新领域插到更前面，其后所有领域的颜色会整体移位换色。
 *    领域集合不变时结果绝对稳定。
 * 2. 领域数超过池长 30 时会绕回池首，必然出现撞色——用户已明确接受。
 * 换来的是任何语料（含未来真实用户的上百个领域）零硬编码自动发色。
 */

/**
 * 循环色库（30 色）。
 *
 * 位置 0–3 是**池子编排**，不是身份映射：池头四色取自参考稿色卡
 * （.tmp/demo/space-redesign.html 的 --d-attn/--d-long/--d-infer/--d-model），
 * 并与 demo 语料的领域首次出现序对齐，所以 demo 在纯顺序规则下仍与参考稿同色。
 * 换一份语料、或 demo 概念顺序一变，同样的位置就换成别的领域——
 * **demo 今天仍与参考稿同色是顺序上的巧合，不是保证**。
 * （bayes 的四领域恰好也落在 0–3，会拿到同一组色，可接受。）
 *
 * 位置 4–29（26 色）是把色相避开池头四色的色相（245.6 / 28.4 / 172.7 / 215.5）
 * 后铺开、再按「到池头四色的最小 RGB 欧氏距离」降序排出来的：最不像池头四色
 * 的排最前，所以典型 4–8 领域语料拿到的是区分度最好的一批。距离区间 115.7
 * （位 4）→ 25.2（位 29），严格单调。
 *
 * 池内 30 色两两不重复，且与 DOMAIN_FALLBACK 精确值不同（有 node 校验守着）。
 *
 * ── 生成脚本（可粘贴复跑；扩池只改 GUARD/TOTAL/TIERS 重跑）──────
 *
 * ```js
 * const HEAD = ["#796FDB","#C58A55","#2A9D8F","#1772F6"]; // 池头四色：demo 首次出现序
 * const AVOID = [245.6,28.4,172.7,215.5].sort((a,b)=>a-b); // 上四色的色相，升序
 * const GUARD = 8;    // 每个池头色相两侧的保护带（度）
 * const TOTAL = 26;   // 位 4–29 的槽位数
 * const TIERS = [[58,52],[54,56],[50,60]]; // [亮度%, 饱和%]，贴近参考稿的克制档
 * const hslToHex = (h, s, l) => {
 *   s /= 100; l /= 100;
 *   const k = (n) => (n + h / 30) % 12;
 *   const a = s * Math.min(l, 1 - l);
 *   const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
 *   const to = (v) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
 *   return "#" + to(f(0)) + to(f(8)) + to(f(4));
 * };
 * const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
 * const dist = (a, b) => { const A = rgb(a), B = rgb(b); return Math.hypot(A[0]-B[0], A[1]-B[1], A[2]-B[2]); };
 * // 1) 把 360 度按四个池头色相切成四段弧，每段两端各留 GUARD 保护带，剩下的可用弧长按比例分配槽位
 * const arcs = [];
 * for (let i = 0; i < AVOID.length; i++) {
 *   const a = AVOID[i];
 *   const b = AVOID[(i + 1) % AVOID.length] + (i === AVOID.length - 1 ? 360 : 0);
 *   arcs.push({ a, b, usable: b - a - 2 * GUARD });
 * }
 * const totalUsable = arcs.reduce((s, x) => s + x.usable, 0);
 * const slots = arcs.map((x) => Math.floor((x.usable / totalUsable) * TOTAL));
 * let left = TOTAL - slots.reduce((a, b) => a + b, 0);
 * arcs.map((_, i) => i).sort((i, j) => arcs[j].usable - arcs[i].usable || i - j)
 *     .forEach((k) => { if (left > 0) { slots[k]++; left--; } });
 * // 2) 每段弧内均匀落点，再按明度档循环取 [l, s]
 * const hues = [];
 * arcs.forEach((x, i) => {
 *   for (let k = 0; k < slots[i]; k++) hues.push(x.a + GUARD + (x.usable / slots[i]) * (k + 0.5));
 * });
 * const cands = hues.map((h, i) => {
 *   const [l, s] = TIERS[i % TIERS.length];
 *   const hex = hslToHex(h, s, l);
 *   return { h: h % 360, l, s, hex, min: Math.min(...HEAD.map((p) => dist(hex, p))) };
 * });
 * // 3) 到池头四色的最小距离降序；距离相同按色相升序打破平局，保证完全确定
 * cands.sort((a, b) => b.min - a.min || a.h - b.h);
 * console.log(cands.map((c) => `"${c.hex}", // h${c.h.toFixed(0)} l=${c.l}% s=${c.s}%`).join("\n"));
 * ```
 *
 * 为什么是「分段弧 + 保护带」而不是「等距网格」：池头色的色相 215.5 与 245.6
 * 只隔 30.1 度，任何 26 等分的网格（间距 13.85 度）都必然把相邻格点顶进这两个
 * 色相的 3 度以内——等距网格在数学上做不到「避开」。分段铺开则保证每个新色相
 * 距任一池头色相 ≥ 13.3 度；代价是保护带处出现 26–30 度的空档（那是刻意的
 * 留白，不是疏漏），段内间距 10.7–17 度。
 */
export const CYCLE_PALETTE = [
  "#796FDB", // [0] 参考稿 --d-attn · 紫
  "#C58A55", // [1] 参考稿 --d-long · 棕
  "#2A9D8F", // [2] 参考稿 --d-infer · 青绿
  "#1772F6", // [3] 参考稿 --d-model · 蓝
  "#CC33A1", // [4] h317 l=50% s=60%
  "#72CC33", // [5] h 95 l=50% s=60%
  "#76CC5C", // [6] h106 l=58% s=52%
  "#CB48BF", // [7] h305 l=54% s=56%
  "#4FCB48", // [8] h117 l=54% s=56%
  "#CC3348", // [9] h352 l=50% s=60%
  "#33CC46", // [10] h127 l=50% s=60%
  "#5CBECC", // [11] h187 l=58% s=52%
  "#96CB48", // [12] h 85 l=54% s=56%
  "#CC5C97", // [13] h329 l=58% s=52%
  "#C05CCC", // [14] h294 l=58% s=52%
  "#C4CC33", // [15] h 63 l=50% s=60%
  "#CB4874", // [16] h340 l=54% s=56%
  "#9F33CC", // [17] h282 l=50% s=60%
  "#5CCC7E", // [18] h138 l=58% s=52%
  "#B2CC5C", // [19] h 74 l=58% s=52%
  "#489ECB", // [20] h201 l=54% s=56%
  "#334BCC", // [21] h231 l=50% s=60%
  "#48CB87", // [22] h149 l=54% s=56%
  "#CBBB48", // [23] h 52 l=54% s=56%
  "#33CC97", // [24] h159 l=50% s=60%
  "#8C48CB", // [25] h271 l=54% s=56%
  "#CC625C", // [26] h  3 l=58% s=52%
  "#CB6848", // [27] h 15 l=54% s=56%
  "#CCAA5C", // [28] h 42 l=58% s=52%
  "#805CCC", // [29] h259 l=58% s=52%
] as const;

/**
 * 领域缺失、或调用方查表未命中时的兜底灰，与稿件 --faint 同色。
 *
 * 走 set 覆盖后 domainColorMap 会给每个传入领域都发到色，它只兜
 * 「领域不在本次传入集合里」这类边界（例如画布上某条边指向的节点取了空
 * domain，而空字符串不在集合里）。
 */
export const DOMAIN_FALLBACK = "#8590A6";

/**
 * 领域首次出现序：配色与画布簇序共用的唯一顺序。
 *
 * 两个调用点（画布传节点、左栏传概念）都必须经过这里，杜绝再次分叉——
 * 分叉正是历史上「同领域在画布和图例不同色」的成因。
 *
 * 取「首次出现」而不是任何排序：排序会引入 locale 依赖，且换个排序键就换一套
 * 颜色；出现序是数据自身的顺序，稳定、无环境依赖、与画布分簇序（layout.ts
 * 按 nodes 首次出现分桶）天然一致。
 */
export function domainOrderOf(concepts: readonly { domain: string }[]): string[] {
  return [...new Set(concepts.map((concept) => concept.domain))];
}

/**
 * 领域名集合 → 颜色表。
 *
 * 严格按入参的首次出现顺序分配：`CYCLE_PALETTE[position % 30]`，不排序、
 * 不查身份表。因此**同一个入参顺序永远得到同一张表**；入参顺序变了，颜色
 * 就跟着变（这是本方案的有意行为，不是 bug）。
 *
 * 返回 Map 是为了让调用方沿用 `colors.get(domain) ?? DOMAIN_FALLBACK` 的写法。
 */
export function domainColorMap(domains: readonly string[]): Map<string, string> {
  const colors = new Map<string, string>();
  const ordered = [...new Set(domains)];
  ordered.forEach((domain, index) => {
    colors.set(domain, CYCLE_PALETTE[index % CYCLE_PALETTE.length] ?? DOMAIN_FALLBACK);
  });
  return colors;
}
