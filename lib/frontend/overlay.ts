import type { CompiledKnowledgeDataset } from "@/data/models";
import type { EditOverlay, OverlayAnnotations, OverlayEntry } from "@/data/overlay";
import { applyOverlay, readOverlayAnnotations } from "@/lib/overlay/apply-overlay.ts";
import { assertEditOverlay } from "@/lib/overlay/schema.ts";
import { datasetAt } from "@/lib/compiler/timeline.ts";
// timelineSteps 只做 re-export（见下），不走本地绑定。

/**
 * Overlay 的 client-safe adapter。
 *
 * 安全边界：UI 一律经这里访问作者修改层。底层 lib/overlay/store.ts 含 node:fs，
 * **client component 绝对不得 import**；本模块只做两件事——
 * 1. HTTP 读写（GET/POST /api/overlay），磁盘细节全部留在服务端；
 * 2. 纯函数折叠与切片（applyOverlay / datasetAt），可安全进 bundle。
 *
 * 时间轴调用顺序固定为 datasetAt(applyOverlay(base, overlay), cutoff)：
 * 先折叠再切片，合并与重命名在每一帧内部保持 id 一致。顺序颠倒（先切后折）
 * 会让锚点解析引用到帧里不存在的概念，语义直接错。buildOverlayView 里
 * 折叠只算一次，帧按 cutoff 从折叠结果派生，UI 拿不到颠倒入口。
 */

export type { EditOverlay, OverlayAnnotations, OverlayEntry } from "@/data/overlay";
export { applyOverlay, readOverlayAnnotations } from "@/lib/overlay/apply-overlay";
export { datasetAt, timelineSteps } from "@/lib/compiler/timeline";

/** 一次读取后的稳定视图：dataset 已折叠 overlay，annotations 是同源的渲染批注。 */
export interface OverlayView {
  /** 纯编译产物，未折叠。保存与差异计算用它，不要写。 */
  base: CompiledKnowledgeDataset;
  overlay: EditOverlay | null;
  /** applyOverlay(base, overlay) 的结果——所有展示消费这份。 */
  dataset: CompiledKnowledgeDataset;
  annotations: OverlayAnnotations;
}

export function buildOverlayView(
  base: CompiledKnowledgeDataset,
  overlay: EditOverlay | null,
): OverlayView {
  const dataset = overlay ? applyOverlay(base, overlay) : base;
  const annotations = overlay ? readOverlayAnnotations(dataset, overlay) : emptyAnnotations();
  return { base, overlay, dataset, annotations };
}

function emptyAnnotations(): OverlayAnnotations {
  return { confirmedRelationIds: [], viewpoints: [], verbs: [], mergedAwayNames: [] };
}

/** 时间轴帧。折叠在 buildOverlayView 已做完，这里只剩切片。 */
export function frameOf(view: OverlayView, cutoff: string): CompiledKnowledgeDataset {
  return datasetAt(view.dataset, cutoff);
}

/** GET /api/overlay。无修改返回 null（服务端契约），不抛错。 */
export async function fetchOverlay(corpus: string): Promise<EditOverlay | null> {
  const response = await fetch(`/api/overlay?corpus=${encodeURIComponent(corpus)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`读取 overlay 失败（HTTP ${response.status}）`);
  const body = (await response.json().catch(() => null)) as { overlay?: unknown } | null;
  if (body?.overlay === null || body?.overlay === undefined) return null;
  // 磁盘内容可能来自旧版本或被人改过——边界上过一遍校验，坏数据宁可炸在读取点。
  assertEditOverlay(body.overlay);
  return body.overlay;
}

/**
 * 追加请求用的 entry 形状：去掉 at。必须分发到联合的每个成员上，
 * 直接 Omit<OverlayEntry, "at"> 会把联合塌成公共键（只剩 at）丢掉全部约束。
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type OverlayEntryRequest = DistributiveOmit<OverlayEntry, "at">;

/** POST /api/overlay。entry 不带 at，服务端盖章；返回追加后的完整 overlay。 */
export async function appendOverlay(
  corpus: string,
  entry: OverlayEntryRequest,
): Promise<EditOverlay> {
  const response = await fetch("/api/overlay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ corpus, entry }),
  });
  const body = (await response.json().catch(() => null)) as {
    overlay?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" && body.error
        ? body.error
        : `写入 overlay 失败（HTTP ${response.status}）`,
    );
  }
  assertEditOverlay(body?.overlay);
  return body!.overlay as EditOverlay;
}
