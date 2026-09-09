import type {
  Article,
  CompiledKnowledgeDataset,
  Creator,
  RawArticle,
} from "@/data/models";
import { extractConcepts } from "./extract-concepts.ts";
import { generateReadingPaths } from "./generate-reading-paths.ts";
import {
  inferArticleConceptRelations,
  inferRelations,
} from "./infer-relations.ts";
import { normalizeConcepts } from "./normalize-concepts.ts";
import type { ConceptResolutionResult } from "./normalize-concepts.ts";
import {
  computeProgress,
  EMPTY_STAGE_COUNTS,
  type CompileProgressHandler,
  type CompileStage,
  type StageCounts,
} from "./progress.ts";
import type { ExtractionProvider } from "./provider.ts";

// CompileStage 的定义搬到了 progress.ts，否则 progress 与 compile 互相 import 会形成
// 运行时循环依赖（compile 要在运行时用 computeProgress）。这里 re-export，
// "@/lib/compiler/compile" 这个既有导入路径保持不变。
export type { CompileStage } from "./progress.ts";

/** Hard cap on how many first-class concepts the knowledge graph shows.
 * Concepts are ranked by how many articles surface them, then confidence. */
const MAX_TOP_LEVEL_CONCEPTS = 10;

function selectTopConcepts(resolution: ConceptResolutionResult, limit: number) {
  const ranked = [...resolution.concepts].sort(
    (a, b) =>
      b.evidenceArticleIds.length - a.evidenceArticleIds.length ||
      b.confidence - a.confidence ||
      a.id.localeCompare(b.id),
  );
  const keepIds = new Set(ranked.slice(0, limit).map(({ id }) => id));
  resolution.concepts = ranked.slice(0, limit);
  for (const [slug, id] of resolution.conceptIdByCandidateSlug) {
    if (!keepIds.has(id)) resolution.conceptIdByCandidateSlug.delete(slug);
  }
}

function compileArticle(article: RawArticle): Article {
  const firstSentence = article.content.split(/(?<=[。！？.!?])/u)[0]?.trim() || article.title;
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    summary: firstSentence,
    publishedAt: article.publishedAt,
    readingTimeMinutes: Math.max(1, Math.ceil(article.content.length / 300)),
    sourceUrl: article.sourceUrl,
  };
}

export async function compileKnowledge({
  creator,
  articles,
  provider,
  onProgress,
}: {
  creator: Creator;
  articles: RawArticle[];
  provider: ExtractionProvider;
  onProgress?: CompileProgressHandler;
}): Promise<CompiledKnowledgeDataset> {
  // counts 随管线推进原地更新；每次派发都传快照副本，
  // 免得异步 handler 反过来看到后续阶段的数字。
  const counts: StageCounts = { ...EMPTY_STAGE_COUNTS, articlesTotal: articles.length };
  const emitStage = (stage: CompileStage) =>
    onProgress?.({
      type: "stage",
      stage,
      counts: { ...counts },
      progress: computeProgress(stage, counts),
    });

  await emitStage("parsing-articles");
  const compiledArticles = articles.map(compileArticle);

  await emitStage("extracting-concepts");
  const extractions = await extractConcepts(articles, provider);
  // articlesDone 表示「已完成抽取的篇数」（computeProgress 拿它细分抽取阶段）。
  // 当前抽取是一次性 Promise.all、没有逐篇 tick，所以只会从 0 跳到全量；
  // 接入真实 tick 时改为每篇完成即 +1，事件形状不变。
  counts.articlesDone = extractions.length;
  counts.conceptCandidates = extractions.reduce((sum, { concepts }) => sum + concepts.length, 0);

  await emitStage("resolving-concepts");
  const resolution = await normalizeConcepts(extractions, provider);
  selectTopConcepts(resolution, MAX_TOP_LEVEL_CONCEPTS);
  counts.concepts = resolution.concepts.length;
  const articleConceptRelations = inferArticleConceptRelations(resolution, extractions);
  counts.articleConceptRelations = articleConceptRelations.length;

  await emitStage("synthesizing-relations");
  const corpusRelations = provider.synthesizeCorpus
    ? await provider.synthesizeCorpus({
        articles,
        concepts: resolution.concepts,
        articleConceptRelations,
        localRelationHints: extractions.flatMap(({ relations }) => relations),
      })
    : [];
  const relations = inferRelations(
    resolution,
    extractions,
    articleConceptRelations,
    corpusRelations,
  );
  counts.conceptRelations = relations.filter(({ kind }) => kind !== "article-concept").length;

  await emitStage("building-reading-paths");

  return {
    schemaVersion: "1.0",
    compiler: { mode: provider.mode, provider: provider.name },
    creator: { ...creator, articleIds: compiledArticles.map(({ id }) => id) },
    articles: compiledArticles,
    concepts: resolution.concepts,
    relations,
    readingPaths: generateReadingPaths(resolution.concepts, compiledArticles, relations),
  };
}
