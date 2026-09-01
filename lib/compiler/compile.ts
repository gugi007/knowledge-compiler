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
import type { ExtractionProvider } from "./provider.ts";

export type CompileStage =
  | "parsing-articles"
  | "extracting-concepts"
  | "resolving-concepts"
  | "synthesizing-relations"
  | "building-reading-paths";

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
  onProgress?: (stage: CompileStage) => void | Promise<void>;
}): Promise<CompiledKnowledgeDataset> {
  await onProgress?.("parsing-articles");
  const compiledArticles = articles.map(compileArticle);
  await onProgress?.("extracting-concepts");
  const extractions = await extractConcepts(articles, provider);
  await onProgress?.("resolving-concepts");
  const resolution = await normalizeConcepts(extractions, provider);
  const articleConceptRelations = inferArticleConceptRelations(resolution, extractions);
  await onProgress?.("synthesizing-relations");
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
  await onProgress?.("building-reading-paths");

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
