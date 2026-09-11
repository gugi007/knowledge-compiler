import bayesCompiled from "@/data/bayes/compiled.json";
import demoCompiled from "@/data/demo/compiled.json";
import type { CompiledKnowledgeDataset } from "@/data/models";

/**
 * 仓库内置的预编译语料，供产品路径（`/compile`、`/space`）使用。
 * id 与 `app/api/compile/route.ts` 的 CORPUS_IDS 对齐，这样「内置语料」与
 * 「可编译语料」是同一组 id，不需要再维护第二组。
 *
 * 注意：id 与旧知识花园的 `?source=` 取值**不再一致**。`app/knowledge-garden.tsx`
 * 是冻结的 legacy 参考基准，它自己的 `?source=sujianlin` 指向 `data/sujianlin/compiled.json`；
 * 那份语料不在本注册表内，也不属于产品路径，仅供 `/legacy` 使用。
 *
 * 这里是静态 import：与 app/knowledge-garden.tsx 现有做法相同，JSON 进 bundle，
 * server component 与 client component 都能直接读，不需要 fetch。
 * 语料数量增长后如果 bundle 体积成为问题，再提 contract change 换成按需加载。
 */

/**
 * 可编译的语料 id，与 app/api/compile/route.ts 的 CORPUS_IDS 对齐。
 *
 * 单一事实来源：`CorpusId` 类型与 `isCorpusId` 的运行时集合都从这份数组派生。
 * 不要再在任何地方手抄一遍字面量列表——抄一份就是一处契约变了会静默漏改的分叉。
 */
export const CORPUS_IDS = ["demo", "bayes", "imported"] as const;

export type CorpusId = (typeof CORPUS_IDS)[number];

/**
 * 运行时集合。只用 Set.has 比对自有 id，
 * `"constructor"` / `"toString"` 这类原型键名不会误命中。
 */
const CORPUS_ID_SET: ReadonlySet<string> = new Set<string>(CORPUS_IDS);

/**
 * 运行时收窄：地址栏 / sessionStorage 等外部字符串 → CorpusId。
 *
 * 消费方：`app/compile/compile-workspace.tsx` 的 `useCorpusParam()`（读 `?corpus=`）。
 * 那里此前自己抄了一份字面量列表，与本文件重复；id 集合一变 UI 就会静默漂移。
 */
export function isCorpusId(value: unknown): value is CorpusId {
  return typeof value === "string" && CORPUS_ID_SET.has(value);
}

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
    id: "bayes",
    label: "概率论与统计推断",
    note: "人工编写的 curated 语料（compiler.mode = curated），作者沈亦舟 @bayes-lab，17 篇含 LaTeX 正文的连载文章，覆盖基础工具、随机变量与分布、联合与极限、统计推断四个领域。",
    dataset: bayesCompiled as CompiledKnowledgeDataset,
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
