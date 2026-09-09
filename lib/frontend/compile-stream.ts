import type { CompiledKnowledgeDataset } from "@/data/models";
import {
  EMPTY_STAGE_COUNTS,
  STAGE_ORDER,
  computeProgress,
  type CompileProgressEvent,
  type CompileStage,
  type ConceptNode,
  type ProvisionalNode,
  type RelationEdge,
  type StageCounts,
} from "@/lib/compiler/progress.ts";

/**
 * `/api/compile` 的 NDJSON 流契约。
 *
 * 类型唯一来源是 lib/compiler/progress.ts——这里只 re-export，绝不重复定义，
 * 否则编译器加字段后前端镜像会静默漂移。
 *
 * 线上传输事件 = 编译进度事件（stage / tick / snapshot）+ 终结事件（complete / error）：
 * - stage：阶段开始，带当前 counts 与估算 progress（0..1）。
 * - tick：增量信号，客户端**追加**（incremental）其 nodes（若带）。
 *   当前服务端不发，接入前不得依赖。
 * - snapshot：阶段末全量集合，客户端**整体替换**（replace）本地累积。
 *   当前服务端不发，接入前不得依赖。
 * - complete：终态，消费方应将 progress 视为 1。
 * - error：流内错误（服务端编译失败）；非流响应错误见 handleCompileResponse。
 */

export type {
  ConceptNode,
  CompileProgressEvent,
  CompileProgressHandler,
  ProvisionalNode,
  RelationEdge,
  StageCounts,
} from "@/lib/compiler/progress.ts";
export {
  computeProgress,
  EMPTY_STAGE_COUNTS,
  STAGE_WEIGHTS,
} from "@/lib/compiler/progress.ts";

export type CompileStreamEvent =
  | CompileProgressEvent
  | { type: "complete"; dataset: CompiledKnowledgeDataset }
  | { type: "error"; message: string };

/** 编译器内部阶段，顺序与 compileKnowledge 的派发一致。re-export 统一来源。 */
export type { CompileStage } from "@/lib/compiler/progress.ts";
export const COMPILE_STAGES: readonly CompileStage[] = STAGE_ORDER;

function isCompileStage(value: unknown): value is CompileStage {
  return typeof value === "string" && (STAGE_ORDER as readonly string[]).includes(value);
}

/**
 * 内部五阶段 → 产品四阶段。
 *
 * UX 规格（docs/页面流与UX设计.md）的编译台只展示四个阶段，
 * 而编译器内部有五个。差异用这张表吸收：
 * 「概念抽取」和「概念合并」在产品叙事里是同一件事。
 *
 * 这是显示层映射。不要为了对齐文案去改编译器阶段划分。
 */
export type ProductStage = "reading" | "concepts" | "relations" | "graph";

export const PRODUCT_STAGES: readonly ProductStage[] = [
  "reading",
  "concepts",
  "relations",
  "graph",
] as const;

export const STAGE_TO_PRODUCT: Record<CompileStage, ProductStage> = {
  "parsing-articles": "reading",
  "extracting-concepts": "concepts",
  "resolving-concepts": "concepts",
  "synthesizing-relations": "relations",
  "building-reading-paths": "graph",
};

/** 产品阶段文案。进行中 / 完成两套，取自 UX 规格 3.3 节。 */
export const PRODUCT_STAGE_COPY: Record<ProductStage, { active: string; done: string }> = {
  reading: { active: "正在读取你的创作列表", done: "已读取创作" },
  concepts: { active: "从创作中识别核心概念", done: "识别出核心概念" },
  relations: { active: "寻找概念间的连接，锚定原文", done: "建立关系，全部可溯源" },
  graph: { active: "知识宇宙即将成型", done: "编译完成" },
};

/**
 * 旧服务端（stage 不带 progress / counts）的兼容估算：按阶段位置线性推。
 * 新契约一律优先用事件自带的 progress；这个函数只是兜底，UI 必须标注为估算。
 */
export function estimateProgress(stage: CompileStage): number {
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0) return 0;
  return Math.min(1, (index + 0.5) / STAGE_ORDER.length);
}

/** counts 必须七个字段全是有限数字才接受，否则视为缺失（旧服务端）。 */
function parseCounts(value: unknown): StageCounts | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  for (const key of Object.keys(EMPTY_STAGE_COUNTS) as (keyof StageCounts)[]) {
    const count = candidate[key];
    if (typeof count !== "number" || !Number.isFinite(count)) return undefined;
  }
  // 逐字段重建：校验已保证七项都是有限数字，重建顺带挡掉脏字段外泄。
  return {
    articlesTotal: candidate.articlesTotal as number,
    articlesDone: candidate.articlesDone as number,
    conceptCandidates: candidate.conceptCandidates as number,
    concepts: candidate.concepts as number,
    coMentionCandidates: candidate.coMentionCandidates as number,
    conceptRelations: candidate.conceptRelations as number,
    articleConceptRelations: candidate.articleConceptRelations as number,
  };
}

function parseProgress(value: unknown, stage: CompileStage, counts: StageCounts, hadCounts: boolean): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  return hadCounts ? computeProgress(stage, counts) : estimateProgress(stage);
}

/** tick 的 nodes / snapshot 的集合：形状不符就当没带，不让坏数组打崩客户端。 */
function objectArray<T>(value: unknown): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "object" && item !== null)
    ? (value as T[])
    : undefined;
}

function parseEvent(line: string): CompileStreamEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const event = value as Record<string, unknown>;

  if (isCompileStage(event.stage)) {
    const stage = event.stage;
    if (event.type === "stage" || event.type === "tick" || event.type === "snapshot") {
      const parsedCounts = parseCounts(event.counts);
      const counts = parsedCounts ?? { ...EMPTY_STAGE_COUNTS };
      const progress = parseProgress(event.progress, stage, counts, parsedCounts !== undefined);
      const base = { type: event.type, stage, counts, progress } as const;
      if (event.type === "tick") {
        const nodes = objectArray<ProvisionalNode>(event.nodes);
        return nodes ? { ...base, type: "tick", nodes } : base;
      }
      if (event.type === "snapshot") {
        const nodes = objectArray<ConceptNode>(event.nodes);
        const edges = objectArray<RelationEdge>(event.edges);
        return {
          ...base,
          type: "snapshot",
          ...(nodes ? { nodes } : {}),
          ...(edges ? { edges } : {}),
        };
      }
      return base;
    }
  }

  if (event.type === "complete" && typeof event.dataset === "object" && event.dataset !== null) {
    return { type: "complete", dataset: event.dataset as CompiledKnowledgeDataset };
  }
  if (event.type === "error") {
    return {
      type: "error",
      message: typeof event.message === "string" && event.message
        ? event.message
        : "Knowledge compilation failed",
    };
  }
  // 未知事件类型：静默忽略，让 API 以后能加新事件而不必同步升级所有前端。
  return undefined;
}

/**
 * 逐行读取 NDJSON 流并派发事件。
 *
 * 抽出来是因为「按 \n 切、跨 chunk 缓冲、收尾冲刷残余」这三件事容易写错，
 * 而编译台与后续集成层都要用同一套解析。
 */
export async function readCompileStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: CompileStreamEvent) => void | Promise<void>,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    // 最后一段可能是半行，留到下一个 chunk。
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = parseEvent(line);
      if (event) await onEvent(event);
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const event = parseEvent(buffer);
    if (event) await onEvent(event);
  }
}

/**
 * /api/compile 的统一入口：先分诊 HTTP 层，再进流。
 *
 * 两类错误必须都处理：
 * - 流外：参数校验（如 corpus/imported 无文章）返回 HTTP 400 的 JSON
 *   `{ error }`，不是 NDJSON；mode=replay 返回 501。
 * - 流内：编译中途失败走 error 事件。
 * 两者都归一化成 onEvent 收到一个 error 事件，消费方只有一条错误路径。
 */
export async function handleCompileResponse(
  response: Response,
  onEvent: (event: CompileStreamEvent) => void | Promise<void>,
): Promise<void> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("application/x-ndjson")) {
    let message = `编译请求失败（HTTP ${response.status}）`;
    if (contentType.includes("application/json")) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (typeof body?.error === "string" && body.error) message = body.error;
    }
    await onEvent({ type: "error", message });
    return;
  }
  if (!response.body) {
    await onEvent({ type: "error", message: "编译响应没有 body" });
    return;
  }
  await readCompileStream(response.body, onEvent);
}
