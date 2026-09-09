import demoCompiled from "@/data/demo/compiled.json";
import sujianlinCompiled from "@/data/sujianlin/compiled.json";
import type { CompiledKnowledgeDataset } from "@/data/models";

/**
 * 仓库内置的预编译语料。id 与旧知识花园的 `?source=` 取值保持一致，
 * 这样新旧两套 UI 指向同一份数据，不需要再维护第二组 id。
 *
 * 这里是静态 import：与 app/knowledge-garden.tsx 现有做法相同，JSON 进 bundle，
 * server component 与 client component 都能直接读，不需要 fetch。
 * 语料数量增长后如果 bundle 体积成为问题，再提 contract change 换成按需加载。
 */
export interface CorpusEntry {
  id: string;
  label: string;
  /** 取材口径说明，展示给读者，跟着语料走而不是跟着作者走。 */
  note?: string;
  dataset: CompiledKnowledgeDataset;
}

export const CORPORA: readonly CorpusEntry[] = [
  {
    id: "demo",
    label: "LLM 综述样例",
    note: "人工编写的演示语料，由确定性 mock provider 编译，离线可复现。",
    dataset: demoCompiled as CompiledKnowledgeDataset,
  },
  {
    id: "sujianlin",
    label: "科学空间（演示）",
    note: "公开演示案例，数据来自公开摘要，版权归原作者。",
    dataset: sujianlinCompiled as CompiledKnowledgeDataset,
  },
] as const;

export const DEFAULT_CORPUS_ID = "demo";

export function findCorpus(id: string | null | undefined): CorpusEntry | undefined {
  if (!id) return undefined;
  return CORPORA.find((corpus) => corpus.id === id);
}

/** 找不到就退回默认语料，保证展示页永远有东西可渲染。 */
export function corpusOrDefault(id: string | null | undefined): CorpusEntry {
  return findCorpus(id) ?? findCorpus(DEFAULT_CORPUS_ID) ?? CORPORA[0]!;
}
