"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { CompiledKnowledgeDataset } from "@/data/models";
import { corpusOrDefault, type CorpusEntry } from "@/lib/frontend/corpora";
import {
  COMPILED_SOURCE_ID,
  parseHandoffDataset,
  readHandoffRaw,
} from "@/lib/frontend/handoff";

/**
 * 决定「当前该展示哪份产物」。
 *
 * 优先级：
 * 1. `?source=compiled` 且交接层有通过校验的产物 → 用刚编译出来的
 * 2. `?source=<语料 id>` → 用该内置语料
 * 3. 都没有 → 默认语料
 *
 * 用 useSyncExternalStore 而不是 useEffect + setState：
 * URL search 与 sessionStorage 都是 React 之外的状态，effect 里 setState
 * 会多跑一轮渲染（也被 react-hooks/set-state-in-effect 拦下）。
 * 这里沿用 app/knowledge-garden.tsx 已验证过的读法。
 *
 * 不用 useSearchParams：那个 API 在静态渲染时要求外层套 Suspense，
 * 三个 feature agent 各自踩一遍不值得。
 *
 * 两个 store 都不订阅变化（subscribe 是空实现）：语料切换走整页导航，
 * 不需要在同一次挂载里响应 URL 变化。若某一幕要做无刷新切换语料，
 * 提 CCR 加真正的 subscribe。
 */

const noopSubscribe = () => () => {};
/** 服务端与 hydration 阶段一律返回 null，客户端再读真实值。 */
const serverSnapshot = () => null;

/** 空字符串表示「已在客户端读过、但 URL 上没有 source」，与服务端的 null 区分开。 */
function sourceSnapshot(): string {
  return new URLSearchParams(window.location.search).get("source") ?? "";
}

export interface ActiveDataset {
  dataset: CompiledKnowledgeDataset;
  /** 产物来源：内置语料 id，或 "compiled" 表示本次运行时编译的结果。 */
  sourceId: string;
  /** 命中内置语料时带上它的元信息；运行时产物为 undefined。 */
  corpus?: CorpusEntry;
  /** false 表示还在首帧默认值，尚未读到 URL 与交接层。 */
  resolved: boolean;
}

export function useActiveDataset(): ActiveDataset {
  const source = useSyncExternalStore(noopSubscribe, sourceSnapshot, serverSnapshot);
  const handoffRaw = useSyncExternalStore(noopSubscribe, readHandoffRaw, serverSnapshot);

  return useMemo(() => {
    // 交接产物要过一遍 schema 校验，失败就当没有，退回内置语料。
    if (source === COMPILED_SOURCE_ID && handoffRaw) {
      const dataset = parseHandoffDataset(handoffRaw);
      if (dataset) {
        return { dataset, sourceId: COMPILED_SOURCE_ID, resolved: true };
      }
    }
    const corpus = corpusOrDefault(source);
    return {
      dataset: corpus.dataset,
      sourceId: corpus.id,
      corpus,
      resolved: source !== null,
    };
  }, [source, handoffRaw]);
}
