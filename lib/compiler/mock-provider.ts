import type { RawArticle, RelationKind } from "@/data/models";
import type {
  ArticleExtraction,
  ExtractedConceptCandidate,
  ExtractionProvider,
} from "./provider.ts";

interface MockConcept {
  name: string;
  slug: string;
  summary: string;
  domain: string;
  level: ExtractedConceptCandidate["level"];
  aliases: string[];
  terms: string[];
  parentSlug?: string;
}

interface MockRelationRule {
  kind: Exclude<RelationKind, "article-concept">;
  sourceSlug: string;
  targetSlug: string;
  confidence: number;
  reasoning: string;
}

// ponytail: curated lexicon keeps the offline demo deterministic; replace this provider for open-world extraction.
const concepts: MockConcept[] = [
  { name: "大语言模型", slug: "large-language-model", summary: "通过大规模语料预训练、能够理解与生成自然语言的概率模型。", domain: "模型基础", level: "foundation", aliases: ["LLM", "Large Language Model"], terms: ["大语言模型", "LLM"] },
  { name: "Transformer", slug: "transformer", summary: "以自注意力和前馈网络为核心的可并行序列建模架构。", domain: "模型基础", level: "foundation", aliases: ["Transformer 架构"], terms: ["Transformer"], parentSlug: "large-language-model" },
  { name: "Attention", slug: "attention", summary: "根据查询与键的匹配程度，对值进行动态加权聚合的信息路由机制。", domain: "注意力机制", level: "foundation", aliases: ["注意力", "自注意力", "Self-Attention"], terms: ["Attention", "注意力", "自注意力"], parentSlug: "transformer" },
  { name: "位置编码", slug: "position-encoding", summary: "向注意力机制注入 token 顺序和相对距离信息的方法。", domain: "注意力机制", level: "foundation", aliases: ["Positional Encoding"], terms: ["位置编码", "Positional Encoding"], parentSlug: "transformer" },
  { name: "RoPE", slug: "rope", summary: "通过旋转变换让注意力分数携带相对位置信息的位置编码方法。", domain: "注意力机制", level: "intermediate", aliases: ["旋转位置编码", "Rotary Position Embedding"], terms: ["RoPE", "旋转位置编码"], parentSlug: "position-encoding" },
  { name: "KV Cache", slug: "kv-cache", summary: "在自回归生成中复用历史 token 的 Key 与 Value，避免重复计算。", domain: "推理系统", level: "intermediate", aliases: ["键值缓存"], terms: ["KV Cache", "键值缓存"], parentSlug: "inference-serving" },
  { name: "FlashAttention", slug: "flash-attention", summary: "通过分块和 IO 感知计算减少显存读写的精确注意力算法。", domain: "注意力机制", level: "advanced", aliases: ["Flash Attention"], terms: ["FlashAttention", "Flash Attention"], parentSlug: "attention" },
  { name: "连续批处理", slug: "continuous-batching", summary: "请求完成后立即补入新请求，让 GPU 批次持续工作的调度策略。", domain: "推理系统", level: "intermediate", aliases: ["Continuous Batching"], terms: ["Continuous Batching", "连续批处理"], parentSlug: "inference-serving" },
  { name: "推理服务", slug: "inference-serving", summary: "围绕吞吐、延迟、显存和公平性组织模型推理的服务系统。", domain: "推理系统", level: "foundation", aliases: ["Inference Serving"], terms: ["推理服务", "Inference Serving"], parentSlug: "large-language-model" },
  { name: "PagedAttention", slug: "paged-attention", summary: "借鉴虚拟内存分页管理 KV Cache、减少显存碎片的方法。", domain: "推理系统", level: "advanced", aliases: ["Paged Attention"], terms: ["PagedAttention", "Paged Attention"], parentSlug: "kv-cache" },
  { name: "vLLM", slug: "vllm", summary: "以 PagedAttention 和连续批处理为核心的高吞吐推理引擎。", domain: "推理系统", level: "advanced", aliases: ["vLLM 引擎"], terms: ["vLLM"], parentSlug: "inference-serving" },
  { name: "长上下文", slug: "long-context", summary: "让模型在更长序列中可靠利用信息的能力。", domain: "长上下文", level: "intermediate", aliases: ["Long Context"], terms: ["长上下文", "Long Context"], parentSlug: "large-language-model" },
  { name: "上下文窗口", slug: "context-window", summary: "单次推理可接收与生成的 token 总预算。", domain: "长上下文", level: "foundation", aliases: ["Context Window"], terms: ["上下文窗口", "Context Window"], parentSlug: "long-context" },
  { name: "量化", slug: "quantization", summary: "用更低精度表示权重或激活，以降低显存占用并提升推理吞吐。", domain: "推理系统", level: "intermediate", aliases: ["Quantization"], terms: ["量化", "Quantization"], parentSlug: "inference-serving" },
  { name: "上下文检索", slug: "context-retrieval", summary: "从外部知识中筛选相关片段，在有限上下文预算内提升信息密度。", domain: "长上下文", level: "intermediate", aliases: ["Context Retrieval", "检索"], terms: ["上下文检索", "Context Retrieval"], parentSlug: "long-context" },
];

const relationRules: MockRelationRule[] = [
  { kind: "prerequisite", sourceSlug: "large-language-model", targetSlug: "transformer", confidence: 0.88, reasoning: "理解语言模型目标有助于定位 Transformer 的作用。" },
  { kind: "prerequisite", sourceSlug: "transformer", targetSlug: "attention", confidence: 0.94, reasoning: "Attention 是 Transformer 的核心计算单元。" },
  { kind: "prerequisite", sourceSlug: "transformer", targetSlug: "position-encoding", confidence: 0.91, reasoning: "位置编码用于补足 Transformer 的顺序信息。" },
  { kind: "extends", sourceSlug: "rope", targetSlug: "position-encoding", confidence: 0.96, reasoning: "RoPE 是位置编码的一种具体扩展。" },
  { kind: "prerequisite", sourceSlug: "attention", targetSlug: "flash-attention", confidence: 0.97, reasoning: "FlashAttention 优化的是 Attention 的精确计算。" },
  { kind: "related", sourceSlug: "rope", targetSlug: "long-context", confidence: 0.89, reasoning: "RoPE 外推会直接影响长上下文能力。" },
  { kind: "prerequisite", sourceSlug: "attention", targetSlug: "kv-cache", confidence: 0.86, reasoning: "KV Cache 缓存 Attention 的键和值。" },
  { kind: "prerequisite", sourceSlug: "kv-cache", targetSlug: "paged-attention", confidence: 0.96, reasoning: "PagedAttention 以分页方式管理 KV Cache。" },
  { kind: "extends", sourceSlug: "paged-attention", targetSlug: "kv-cache", confidence: 0.95, reasoning: "PagedAttention 扩展了 KV Cache 的内存管理方式。" },
  { kind: "prerequisite", sourceSlug: "inference-serving", targetSlug: "continuous-batching", confidence: 0.84, reasoning: "连续批处理解决推理服务的吞吐调度问题。" },
  { kind: "prerequisite", sourceSlug: "kv-cache", targetSlug: "vllm", confidence: 0.9, reasoning: "vLLM 的内存管理建立在 KV Cache 之上。" },
  { kind: "prerequisite", sourceSlug: "continuous-batching", targetSlug: "vllm", confidence: 0.9, reasoning: "连续批处理是 vLLM 的核心调度能力。" },
  { kind: "extends", sourceSlug: "vllm", targetSlug: "inference-serving", confidence: 0.93, reasoning: "vLLM 是推理服务的工程实现。" },
  { kind: "related", sourceSlug: "flash-attention", targetSlug: "kv-cache", confidence: 0.78, reasoning: "两者分别优化预填充计算和解码缓存。" },
  { kind: "prerequisite", sourceSlug: "context-window", targetSlug: "long-context", confidence: 0.9, reasoning: "上下文窗口定义长上下文的长度边界。" },
  { kind: "related", sourceSlug: "long-context", targetSlug: "kv-cache", confidence: 0.92, reasoning: "上下文长度直接决定 KV Cache 成本。" },
  { kind: "related", sourceSlug: "quantization", targetSlug: "inference-serving", confidence: 0.85, reasoning: "量化会改变推理服务的显存与吞吐瓶颈。" },
  { kind: "related", sourceSlug: "context-retrieval", targetSlug: "long-context", confidence: 0.91, reasoning: "检索与长上下文共同提升可用信息量。" },
  { kind: "related", sourceSlug: "quantization", targetSlug: "vllm", confidence: 0.8, reasoning: "vLLM 可用量化模型降低服务成本。" },
  { kind: "extends", sourceSlug: "context-retrieval", targetSlug: "context-window", confidence: 0.82, reasoning: "检索在固定窗口内扩展了可访问知识范围。" },
];

function evidenceQuote(article: RawArticle, terms: string[]) {
  const sentence = article.content
    .split(/(?<=[。！？.!?])/u)
    .find((part) => terms.some((term) => part.toLocaleLowerCase().includes(term.toLocaleLowerCase())));
  return (sentence ?? article.title).trim();
}

export class DeterministicMockProvider implements ExtractionProvider {
  readonly name = "deterministic-mock";
  readonly mode = "mock";

  async extract(article: RawArticle): Promise<ArticleExtraction> {
    const haystack = `${article.title}\n${article.content}`.toLocaleLowerCase();
    const found = concepts.filter((concept) =>
      concept.terms.some((term) => haystack.includes(term.toLocaleLowerCase())),
    );
    const foundSlugs = new Set(found.map(({ slug }) => slug));

    return {
      articleId: article.id,
      concepts: found.map((concept) => ({
        ...concept,
        confidence: concept.terms.some((term) => article.title.toLocaleLowerCase().includes(term.toLocaleLowerCase())) ? 0.96 : 0.86,
        evidence: { articleId: article.id, quote: evidenceQuote(article, concept.terms) },
      })),
      relations: relationRules
        .filter(({ sourceSlug, targetSlug }) => foundSlugs.has(sourceSlug) && foundSlugs.has(targetSlug))
        .map((rule) => ({
          ...rule,
          evidence: {
            articleId: article.id,
            quote: evidenceQuote(article, [
              concepts.find(({ slug }) => slug === rule.sourceSlug)!.name,
              concepts.find(({ slug }) => slug === rule.targetSlug)!.name,
            ]),
          },
        })),
    };
  }
}
