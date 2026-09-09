import type { CompiledKnowledgeDataset } from "@/data/models";

/**
 * `/api/compile` 的 NDJSON 流契约。
 *
 * 当前 API（app/api/compile/route.ts）只发三种事件：stage / complete / error，
 * 每行一个 JSON。这里的类型是对那份实现的镜像，不是许愿单——
 * 改这里之前先确认 API 真的发了对应事件。
 *
 * 已知缺口：没有 tick / counts / 增量节点事件，所以编译台的迷你图谱
 * 在编译过程中拿不到逐步长出来的概念，只能在 complete 时一次性拿到全量产物。
 * 若要做「星体逐个出现」，需要走 CCR 扩流（见 docs/frontend-v2-architecture.md）。
 */

export type CompileStage =
  | "parsing-articles"
  | "extracting-concepts"
  | "resolving-concepts"
  | "synthesizing-relations"
  | "building-reading-paths";

export type CompileStreamEvent =
  | { type: "stage"; stage: CompileStage }
  | { type: "complete"; dataset: CompiledKnowledgeDataset }
  | { type: "error"; message: string };

/** 编译器内部阶段，顺序与 compileKnowledge 的 onProgress 调用一致。 */
export const COMPILE_STAGES: readonly CompileStage[] = [
  "parsing-articles",
  "extracting-concepts",
  "resolving-concepts",
  "synthesizing-relations",
  "building-reading-paths",
] as const;

function isCompileStage(value: unknown): value is CompileStage {
  return typeof value === "string" && (COMPILE_STAGES as readonly string[]).includes(value);
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
 * 按阶段权重估算的整体进度 [0,1]。
 *
 * 这是估算，不是精确进度：抽取阶段实际耗时远超其余四段之和，
 * 但当前流事件不带「已完成第几篇」，所以只能按阶段位置线性推。
 * UI 必须把它呈现为估算，不要写成精确百分比。
 */
export function estimateProgress(stage: CompileStage): number {
  const index = COMPILE_STAGES.indexOf(stage);
  if (index < 0) return 0;
  // 阶段刚开始时算该段的一半，下一个 stage 事件到达时推进到下一段。
  return Math.min(1, (index + 0.5) / COMPILE_STAGES.length);
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

  if (event.type === "stage" && isCompileStage(event.stage)) {
    return { type: "stage", stage: event.stage };
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
