import type {
  Article,
  CompiledKnowledgeDataset,
  Creator,
  RawArticle,
} from "@/data/models";
import { extractConcepts } from "./extract-concepts.ts";
import { generateReadingPaths } from "./generate-reading-paths.ts";
import { inferRelations } from "./infer-relations.ts";
import { normalizeConcepts } from "./normalize-concepts.ts";
import type { ExtractionProvider } from "./provider.ts";

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
}: {
  creator: Creator;
  articles: RawArticle[];
  provider: ExtractionProvider;
}): Promise<CompiledKnowledgeDataset> {
  const extractions = await extractConcepts(articles, provider);
  const concepts = normalizeConcepts(extractions);
  const relations = inferRelations(concepts, extractions);
  const compiledArticles = articles.map(compileArticle);

  return {
    schemaVersion: "1.0",
    compiler: { mode: provider.mode, provider: provider.name },
    creator: { ...creator, articleIds: compiledArticles.map(({ id }) => id) },
    articles: compiledArticles,
    concepts,
    relations,
    readingPaths: generateReadingPaths(concepts, compiledArticles, relations),
  };
}
