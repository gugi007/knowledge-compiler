import type { RawArticle } from "@/data/models";
import type { ArticleExtraction, ExtractionProvider } from "./provider";

export async function extractConcepts(
  articles: RawArticle[],
  provider: ExtractionProvider,
): Promise<ArticleExtraction[]> {
  return Promise.all(articles.map((article) => provider.extract(article)));
}
