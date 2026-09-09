import { NextResponse, type NextRequest } from "next/server";
import type { OverlayEntry } from "@/data/overlay";
import { assertOverlayEntryRequest } from "@/lib/overlay/schema";
import { appendEntry, readOverlay, sanitizeCorpusKey } from "@/lib/overlay/store";

export const runtime = "nodejs";

/**
 * 作者修改层的最小 API。只读写 overlay 本身，不碰 dataset——
 * 折叠由客户端拿 overlay 后走 lib/overlay 的纯函数完成。
 *
 * GET  /api/overlay?corpus=demo → { corpus, overlay: EditOverlay | null }
 * POST /api/overlay body { corpus, entry }（entry 不带 at，服务端盖章）→ 同上，overlay 为追加后的完整视图
 */

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const corpus = new URL(request.url).searchParams.get("corpus") ?? "";
  let key: string;
  try {
    key = sanitizeCorpusKey(corpus);
  } catch {
    return badRequest("corpus 只允许小写字母、数字和连字符。");
  }
  const overlay = await readOverlay(key);
  return NextResponse.json({ corpus: key, overlay: overlay ?? null });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    corpus?: unknown;
    entry?: unknown;
  } | null;
  if (!body || typeof body.corpus !== "string" || !body.entry) {
    return badRequest("请求体必须是 { corpus, entry }。");
  }
  let key: string;
  try {
    key = sanitizeCorpusKey(body.corpus);
  } catch {
    return badRequest("corpus 只允许小写字母、数字和连字符。");
  }
  try {
    assertOverlayEntryRequest(body.entry);
  } catch (cause) {
    return badRequest(cause instanceof Error ? cause.message : "entry 校验失败");
  }
  // 追加前按当前 merged 长度收紧 cancels 上界（越界 = 指向不存在的条目）。
  const current = await readOverlay(key);
  const cancels = (body.entry as { cancels?: number }).cancels;
  if (typeof cancels === "number" && cancels >= (current?.entries.length ?? 0)) {
    return badRequest("cancels 必须指向已存在的更早条目。");
  }
  try {
    const overlay = await appendEntry(key, body.entry as OverlayEntry);
    return NextResponse.json({ corpus: key, overlay });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "写入 overlay 失败";
    // 请求侧契约错误在上面已拦下；这里剩下的分支：cancels 指向种子条目 = 400，
    // 磁盘文件损坏 / 写失败 = 500。
    if (message.includes("seed entry")) return badRequest(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
