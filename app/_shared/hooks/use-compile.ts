"use client";

import { useCallback, useRef, useState } from "react";
import type { CompiledKnowledgeDataset } from "@/data/models";
import {
  COMPILE_STAGES,
  estimateProgress,
  readCompileStream,
  STAGE_TO_PRODUCT,
  type CompileStage,
  type ProductStage,
} from "@/lib/frontend/compile-stream";
import { saveHandoffDataset } from "@/lib/frontend/handoff";

/**
 * 驱动 `/api/compile` 的唯一一份客户端逻辑。
 *
 * 归 architect 维护，compiler-ui-agent 直接用、不要各自再写一份 fetch + NDJSON 解析：
 * 「流式读取 + 阶段推进 + 产物交接」这三件事一旦有两份实现，
 * 编译台与知识空间就会在产物落地时机上对不上。
 *
 * 成功后自动写入交接层（sessionStorage），第三幕因此不需要知道编译怎么跑的。
 */

export type CompileStatus = "idle" | "running" | "done" | "error";

export interface CompileState {
  status: CompileStatus;
  /** 编译器内部阶段。UI 若只展示四个产品阶段，用 productStage。 */
  stage?: CompileStage;
  productStage?: ProductStage;
  /** [0,1]，按阶段权重估算，不是精确进度。 */
  progress: number;
  completedStages: CompileStage[];
  dataset?: CompiledKnowledgeDataset;
  error?: string;
}

const IDLE: CompileState = {
  status: "idle",
  progress: 0,
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

    try {
      const response = await fetch("/api/compile", { method: "POST" });
      if (!response.ok || !response.body) {
        throw new Error(`编译请求失败（${response.status}）`);
      }

      let completed = false;

      await readCompileStream(response.body, (event) => {
        if (event.type === "stage") {
          const finished = previous;
          previous = event.stage;
          setState((current) => ({
            ...current,
            status: "running",
            stage: event.stage,
            productStage: STAGE_TO_PRODUCT[event.stage],
            progress: estimateProgress(event.stage),
            completedStages: finished
              ? [...new Set([...current.completedStages, finished])]
              : current.completedStages,
          }));
          return;
        }

        if (event.type === "complete") {
          completed = true;
          // 交接产物只在这里写一次，读取方一律走 handoff.ts。
          saveHandoffDataset(event.dataset);
          setState({
            status: "done",
            progress: 1,
            completedStages: [...COMPILE_STAGES],
            dataset: event.dataset,
          });
          return;
        }

        throw new Error(event.message);
      });

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
