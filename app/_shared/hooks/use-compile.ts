"use client";

import { useCallback, useRef, useState } from "react";
import type { CompiledKnowledgeDataset } from "@/data/models";
import {
  COMPILE_STAGES,
  EMPTY_STAGE_COUNTS,
  STAGE_TO_PRODUCT,
  handleCompileResponse,
  type CompileStage,
  type CompileStreamEvent,
  type ProductStage,
  type StageCounts,
} from "@/lib/frontend/compile-stream";
import { saveHandoffDataset } from "@/lib/frontend/handoff";

/**
 * 驱动 `/api/compile` 的唯一一份客户端逻辑。
 *
 * 归 architect 维护，compiler-ui-agent 直接用、不要各自再写一份 fetch + NDJSON 解析：
 * 「流式读取 + 阶段推进 + 产物交接」这三件事一旦有两份实现，
 * 编译台与知识空间就会在产物落地时机上对不上。
 *
 * 事件契约（含 tick / snapshot 的 incremental / replace 语义）见
 * lib/frontend/compile-stream.ts；这里只做状态折叠。
 * 成功后自动写入交接层（sessionStorage），第三幕因此不需要知道编译怎么跑的。
 */

export type CompileStatus = "idle" | "running" | "done" | "error";

export interface CompileState {
  status: CompileStatus;
  /** 编译器内部阶段。UI 若只展示四个产品阶段，用 productStage。 */
  stage?: CompileStage;
  productStage?: ProductStage;
  /** [0,1]。新服务端直接取事件自带的 progress（旧服务端由 adapter 兜底估算）。 */
  progress: number;
  /** 最近一次进度事件的 counts 快照；idle 为全 0。 */
  counts: StageCounts;
  completedStages: CompileStage[];
  dataset?: CompiledKnowledgeDataset;
  error?: string;
}

const IDLE: CompileState = {
  status: "idle",
  progress: 0,
  counts: { ...EMPTY_STAGE_COUNTS },
  completedStages: [],
};

export function useCompile() {
  const [state, setState] = useState<CompileState>(IDLE);
  // 防重入：按钮连点或 effect 重复触发时，只跑一条流。
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    if (runningRef.current) return;
    setState(IDLE);
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setState({ ...IDLE, status: "running" });

    // 上一个阶段在下一个 stage 事件到达时才算完成，因此要记住它。
    let previous: CompileStage | undefined;
    let failure: string | undefined;
    let completed = false;

    const onEvent = (event: CompileStreamEvent) => {
      if (event.type === "stage") {
        const finished = previous;
        previous = event.stage;
        setState((current) => ({
          ...current,
          status: "running",
          stage: event.stage,
          productStage: STAGE_TO_PRODUCT[event.stage],
          progress: event.progress,
          counts: event.counts,
          completedStages: finished
            ? [...new Set([...current.completedStages, finished])]
            : current.completedStages,
        }));
        return;
      }

      if (event.type === "tick" || event.type === "snapshot") {
        // tick 是增量、snapshot 是替换——但对「当前 counts / progress」而言都是覆盖为最新值。
        // 迷你图谱若要做逐星出现，在这里按语义累积 event.nodes（当前服务端不发）。
        setState((current) => ({
          ...current,
          status: "running",
          stage: event.stage,
          productStage: STAGE_TO_PRODUCT[event.stage],
          progress: event.progress,
          counts: event.counts,
        }));
        return;
      }

      if (event.type === "complete") {
        completed = true;
        // 交接产物只在这里写一次，读取方一律走 handoff.ts。
        saveHandoffDataset(event.dataset);
        const relations = event.dataset.relations;
        const articles = event.dataset.articles.length;
        setState({
          status: "done",
          progress: 1,
          // 终态 counts 由产物精确回填；candidates/共现是过程量，完成后不可回推，留 0。
          counts: {
            articlesTotal: articles,
            articlesDone: articles,
            conceptCandidates: 0,
            concepts: event.dataset.concepts.length,
            coMentionCandidates: 0,
            conceptRelations: relations.filter(({ kind }) => kind !== "article-concept").length,
            articleConceptRelations: relations.filter(({ kind }) => kind === "article-concept").length,
          },
          completedStages: [...COMPILE_STAGES],
          dataset: event.dataset,
        });
        return;
      }

      failure = event.message;
    };

    try {
      const response = await fetch("/api/compile", { method: "POST" });
      // handleCompileResponse 已把流外 400/501 JSON 与流内 error 归一化成 error 事件。
      await handleCompileResponse(response, onEvent);
      if (failure) throw new Error(failure);
      if (!completed) throw new Error("编译结束但没有产出数据集");
    } catch (cause) {
      setState((current) => ({
        ...current,
        status: "error",
        stage: undefined,
        productStage: undefined,
        error: cause instanceof Error ? cause.message : "编译失败",
      }));
    } finally {
      runningRef.current = false;
    }
  }, []);

  return { ...state, start, reset };
}
