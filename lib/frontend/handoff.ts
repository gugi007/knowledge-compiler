import type { CompiledKnowledgeDataset } from "@/data/models";
import { assertCompiledKnowledgeDataset } from "@/lib/compiler/schema";

/**
 * 编译台 → 知识空间的产物交接。
 *
 * 为什么要一层 adapter：编译产物是运行时算出来的，不在仓库里，
 * 第二幕算完、第三幕要读。两幕由不同 agent 实现，若各自直接调
 * sessionStorage 并各写一遍 key，迟早对不上。所有读写都走这里。
 *
 * 为什么用 sessionStorage 而不是 URL 或服务端：产物有几百 KB，塞不进 URL；
 * 当前分支没有账户与数据库，服务端无处存。刷新保留、关标签页即弃，
 * 正好符合「演示用一次编译」的语义。
 *
 * KEY 与旧知识花园（app/knowledge-garden.tsx）使用的键相同，
 * 因此 legacy 视图仍能读到新编译的产物，不必改动那份参考实现。
 */
const KEY = "knowledge-compiler:dataset";

/** 产物来源：内置预编译语料，或本次运行时编译的结果。 */
export const COMPILED_SOURCE_ID = "compiled";

function storage(): Storage | undefined {
  // SSR 与隐私模式（Safari 无痕下 sessionStorage 可能抛错）都要兜住。
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function saveHandoffDataset(dataset: CompiledKnowledgeDataset): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(dataset));
  } catch {
    // 配额超限或被禁用：交接失败不该让编译台崩掉，
    // 第三幕会退回内置语料。
  }
}

/**
 * 原始字符串。返回值是稳定的字符串基元，可直接用作 useSyncExternalStore 的快照
 * （同内容字符串 Object.is 相等，不会触发重渲染循环）。
 */
export function readHandoffRaw(): string | null {
  return storage()?.getItem(KEY) ?? null;
}

export function clearHandoffDataset(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // 同上，忽略。
  }
}

/**
 * 校验并解析交接产物。
 *
 * 用编译器自己的 assertCompiledKnowledgeDataset 校验，而不是信任
 * sessionStorage 里的内容——那是上一次会话写的，可能是旧 schema，
 * 也可能被手工改过。校验失败返回 null，让调用方退回内置语料。
 *
 * 拆成纯函数是为了配合 useSyncExternalStore：快照拿原始字符串，
 * 解析与校验放在 useMemo 里，避免每次渲染都重新校验一遍产物。
 */
export function parseHandoffDataset(raw: string): CompiledKnowledgeDataset | null {
  try {
    const value: unknown = JSON.parse(raw);
    assertCompiledKnowledgeDataset(value);
    return value;
  } catch {
    return null;
  }
}

/** 读取并校验交接产物。非 React 场景用这个。 */
export function readHandoffDataset(): CompiledKnowledgeDataset | null {
  const raw = readHandoffRaw();
  return raw ? parseHandoffDataset(raw) : null;
}
