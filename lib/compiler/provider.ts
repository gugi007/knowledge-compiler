import type { Evidence, RawArticle, RelationKind } from "@/data/models";

export interface ExtractedConceptCandidate {
  name: string;
  slug: string;
  summary: string;
  domain: string;
  level: "foundation" | "intermediate" | "advanced";
  aliases: string[];
  parentSlug?: string;
  confidence: number;
  evidence: Evidence;
}

export interface ExtractedRelationHint {
  kind: Exclude<RelationKind, "article-concept">;
  sourceSlug: string;
  targetSlug: string;
  confidence: number;
  evidence: Evidence;
  reasoning?: string;
}

export interface ArticleExtraction {
  articleId: string;
  concepts: ExtractedConceptCandidate[];
  relations: ExtractedRelationHint[];
}

export interface ExtractionProvider {
  readonly name: string;
  readonly mode: string;
  extract(article: RawArticle): Promise<ArticleExtraction>;
}
