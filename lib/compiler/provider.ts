import type {
  Concept,
  Evidence,
  RawArticle,
  Relation,
  RelationKind,
} from "@/data/models";

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
  evidence: Evidence[];
  reasoning?: string;
}

export interface ArticleExtraction {
  articleId: string;
  concepts: ExtractedConceptCandidate[];
  relations: ExtractedRelationHint[];
}

export interface ConceptResolutionGroup {
  id: string;
  names: string[];
  slugs: string[];
  aliases: string[];
  candidates: ExtractedConceptCandidate[];
}

export interface ConceptResolutionDecision {
  groupIds: string[];
  canonicalName?: string;
  canonicalSlug?: string;
  aliases?: string[];
  confidence?: number;
}

export interface ConceptResolutionInput {
  groups: ConceptResolutionGroup[];
}

export interface CorpusSynthesisInput {
  articles: RawArticle[];
  concepts: Concept[];
  articleConceptRelations: Relation[];
  localRelationHints: ExtractedRelationHint[];
}

export interface SynthesizedConceptRelation {
  kind: Exclude<RelationKind, "article-concept">;
  sourceConceptId: string;
  targetConceptId: string;
  confidence: number;
  evidence: Evidence[];
  reasoning?: string;
}

export interface ExtractionProvider {
  readonly name: string;
  readonly mode: string;
  extract(article: RawArticle): Promise<ArticleExtraction>;
  resolveConcepts?(input: ConceptResolutionInput): Promise<ConceptResolutionDecision[]>;
  synthesizeCorpus?(input: CorpusSynthesisInput): Promise<SynthesizedConceptRelation[]>;
}
