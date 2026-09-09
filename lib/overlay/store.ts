import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EditOverlay, OverlayEntry } from "@/data/overlay";
import { assertEditOverlay } from "./schema.ts";

/**
 * 服务端专用：读写磁盘上的 overlay。含 node:fs，**绝不能被 client component 导入**
 * （也不经 index.ts re-export，防止顺手 import 到客户端）。
 *
 * 为什么落盘而不是放 session：lib/zhihu/session.ts 自己写明状态会在重启和
 * next dev 热重载时丢失。演示中途改了一堆东西然后 HMR 清空，是不可接受的。
 *
 * 目录约定（都在 data/overlays/ 下）：
 * - `<corpusKey>.seed.json`  种子，提交进库。演示用的历史修改，
 *   让第三幕的观点演变时间线一打开就有内容，不用现场点出来。
 * - `<corpusKey>.json`       运行时真实修改，已 gitignore。
 * readOverlay 把两者按「种子在前、运行时在后」拼成一份，语义上就是同一部编辑史。
 *
 * 索引约定：entry.cancels 指的是 **merged 视图（种子 ++ 运行时）的全局下标**。
 * 种子文件提交进库后不可变，全局下标因此稳定；运行时条目原样存客户端算好的下标。
 */

const OVERLAY_DIR = resolve(process.env.DATA_DIR ?? "data", "overlays");

/** 只允许 [a-z0-9-]，挡掉路径穿越。corpusKey 会拼进文件路径，必须收敛。 */
export function sanitizeCorpusKey(corpusKey: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(corpusKey)) {
    throw new Error(`invalid corpus key: ${JSON.stringify(corpusKey)}`);
  }
  return corpusKey;
}

export function overlayPath(corpusKey: string): string {
  return resolve(OVERLAY_DIR, `${sanitizeCorpusKey(corpusKey)}.json`);
}

export function seedOverlayPath(corpusKey: string): string {
  return resolve(OVERLAY_DIR, `${sanitizeCorpusKey(corpusKey)}.seed.json`);
}

async function readOverlayFile(path: string, corpusKey: string): Promise<EditOverlay | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
  const value: unknown = JSON.parse(text);
  assertEditOverlay(value, path);
  if (value.corpusKey !== corpusKey) {
    throw new Error(`${path}: corpusKey "${value.corpusKey}" does not match "${corpusKey}"`);
  }
  return value;
}

/** 两份都不存在时返回 undefined，让调用方走「无修改」分支。 */
export async function readOverlay(corpusKey: string): Promise<EditOverlay | undefined> {
  const key = sanitizeCorpusKey(corpusKey);
  const seed = await readOverlayFile(seedOverlayPath(key), key);
  const runtime = await readOverlayFile(overlayPath(key), key);
  if (!seed && !runtime) return undefined;
  return {
    overlayVersion: "1.0",
    corpusKey: key,
    entries: [...(seed?.entries ?? []), ...(runtime?.entries ?? [])],
  };
}

// 读-改-写不是原子的；并发追加用模块级 promise 链串行化。
let writeChain: Promise<unknown> = Promise.resolve();

/**
 * 追加一条修改并落盘，返回追加后的完整 merged overlay。
 *
 * entry.at 由这里用服务端时间覆盖，调用方传什么都不算——否则时间线可被伪造。
 */
export async function appendEntry(corpusKey: string, entry: OverlayEntry): Promise<EditOverlay> {
  const key = sanitizeCorpusKey(corpusKey);
  const operation = async (): Promise<EditOverlay> => {
    const runtimePath = overlayPath(key);
    const runtime =
      (await readOverlayFile(runtimePath, key)) ??
      ({ overlayVersion: "1.0", corpusKey: key, entries: [] } as EditOverlay);
    const seed = await readOverlayFile(seedOverlayPath(key), key);
    const seedLength = seed?.entries.length ?? 0;
    const cancels = (entry as { cancels?: number }).cancels;
    if (typeof cancels === "number" && cancels < seedLength) {
      throw new Error(`cancels must not target a seed entry (index ${cancels} < ${seedLength})`);
    }
    const stamped = { ...entry, at: new Date().toISOString() } as OverlayEntry;
    runtime.entries.push(stamped);
    assertEditOverlay(runtime, runtimePath);
    await mkdir(OVERLAY_DIR, { recursive: true });
    await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
    const merged = await readOverlay(key);
    if (!merged) throw new Error("overlay vanished right after write");
    return merged;
  };
  const queued = writeChain.then(operation, operation);
  writeChain = queued.catch(() => undefined);
  return queued;
}
