import type { CompiledKnowledgeDataset, RawArticle } from "@/data/models";
import type {
  ArticleExtraction,
  ConceptResolutionDecision,
  ConceptResolutionInput,
  CorpusSynthesisInput,
  SynthesizedConceptRelation,
} from "./provider.ts";

type UnknownRecord = Record<string, unknown>;

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function record(value: unknown, path: string): UnknownRecord {
  expect(typeof value === "object" && value !== null && !Array.isArray(value), `${path} must be an object`);
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, allowed: string[], path: string) {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    expect(allowedKeys.has(key), `${path}.${key} is not allowed`);
  }
}

function text(value: unknown, path: string) {
  expect(typeof value === "string" && value.trim().length > 0, `${path} must be a non-empty string`);
}

function textArray(value: unknown, path: string) {
  expect(Array.isArray(value), `${path} must be an array`);
  value.forEach((item, index) => text(item, `${path}[${index}]`));
}

function confidence(value: unknown, path: string) {
  expect(typeof value === "number" && value >= 0 && value <= 1, `${path} must be between 0 and 1`);
}

function evidence(value: unknown, path: string, articles: Map<string, RawArticle>) {
  const item = record(value, path);
  exactKeys(item, ["articleId", "quote", "startOffset", "endOffset", "supportScore"], path);
  text(item.articleId, `${path}.articleId`);
  text(item.quote, `${path}.quote`);
  const article = articles.get(item.articleId as string);
  expect(article, `${path}.articleId references an unknown article`);
  expect(article.content.includes(item.quote as string), `${path}.quote must be copied verbatim from article content`);
  if (item.startOffset !== undefined || item.endOffset !== undefined) {
    expect(Number.isInteger(item.startOffset) && Number(item.startOffset) >= 0, `${path}.startOffset must be a non-negative integer`);
    expect(Number.isInteger(item.endOffset) && Number(item.endOffset) > Number(item.startOffset), `${path}.endOffset must follow startOffset`);
    expect(article.content.slice(Number(item.startOffset), Number(item.endOffset)) === item.quote, `${path} offsets must match quote`);
  }
  confidence(item.supportScore, `${path}.supportScore`);
}

function mentions(value: string, terms: string[]) {
  return terms.some((term) => {
    if (/\p{Script=Han}/u.test(term)) return value.includes(term);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(value);
  });
}

export function assertArticleExtraction(
  value: unknown,
  article: RawArticle,
): asserts value is ArticleExtraction {
  const extraction = record(value, "extraction");
  exactKeys(extraction, ["articleId", "concepts", "relations"], "extraction");
  expect(extraction.articleId === article.id, "extraction.articleId must match the input article");
  expect(Array.isArray(extraction.concepts), "extraction.concepts must be an array");
  const articles = new Map([[article.id, article]]);
  const termsBySlug = new Map<string, string[]>();

  extraction.concepts.forEach((value, index) => {
    const concept = record(value, `extraction.concepts[${index}]`);
    exactKeys(concept, ["name", "slug", "summary", "domain", "level", "aliases", "parentSlug", "confidence", "evidence"], `extraction.concepts[${index}]`);
    for (const field of ["name", "slug", "summary", "domain"] as const) text(concept[field], `extraction.concepts[${index}].${field}`);
    expect(["foundation", "intermediate", "advanced"].includes(concept.level as string), `extraction.concepts[${index}].level is invalid`);
    textArray(concept.aliases, `extraction.concepts[${index}].aliases`);
    if (concept.parentSlug !== undefined) text(concept.parentSlug, `extraction.concepts[${index}].parentSlug`);
    confidence(concept.confidence, `extraction.concepts[${index}].confidence`);
    evidence(concept.evidence, `extraction.concepts[${index}].evidence`, articles);
    const quote = record(concept.evidence, `extraction.concepts[${index}].evidence`).quote as string;
    const terms = [concept.name as string, ...(concept.aliases as string[])];
    expect(mentions(quote, terms), `extraction.concepts[${index}].evidence must mention the concept`);
    expect(!termsBySlug.has(concept.slug as string), `extraction concept slug must be unique: ${concept.slug}`);
    termsBySlug.set(concept.slug as string, terms);
  });

  expect(Array.isArray(extraction.relations), "extraction.relations must be an array");
  extraction.relations.forEach((value, index) => {
    const relation = record(value, `extraction.relations[${index}]`);
    exactKeys(relation, ["kind", "sourceSlug", "targetSlug", "confidence", "evidence", "reasoning"], `extraction.relations[${index}]`);
    expect(["prerequisite", "related", "extends"].includes(relation.kind as string), `extraction.relations[${index}].kind is invalid`);
    text(relation.sourceSlug, `extraction.relations[${index}].sourceSlug`);
    text(relation.targetSlug, `extraction.relations[${index}].targetSlug`);
    expect(relation.sourceSlug !== relation.targetSlug, `extraction.relations[${index}] cannot be a self-loop`);
    const sourceTerms = termsBySlug.get(relation.sourceSlug as string);
    const targetTerms = termsBySlug.get(relation.targetSlug as string);
    expect(sourceTerms && targetTerms, `extraction.relations[${index}] must reference extracted concepts`);
    confidence(relation.confidence, `extraction.relations[${index}].confidence`);
    expect(Array.isArray(relation.evidence) && relation.evidence.length > 0, `extraction.relations[${index}].evidence must be non-empty`);
    relation.evidence.forEach((item, evidenceIndex) => {
      const path = `extraction.relations[${index}].evidence[${evidenceIndex}]`;
      evidence(item, path, articles);
      const quote = record(item, path).quote as string;
      expect(mentions(quote, sourceTerms) && mentions(quote, targetTerms), `${path} must mention both relation endpoints`);
    });
    text(relation.reasoning, `extraction.relations[${index}].reasoning`);
  });
}

export function assertConceptResolutionDecisions(
  value: unknown,
  input: ConceptResolutionInput,
): asserts value is ConceptResolutionDecision[] {
  expect(Array.isArray(value), "resolution.decisions must be an array");
  const knownGroups = new Set(input.groups.map(({ id }) => id));
  const allowedPairs = new Set(input.candidatePairs.map(({ groupIds }) => [...groupIds].sort().join("\0")));
  const assignedGroups = new Set<string>();

  value.forEach((item, index) => {
    const decision = record(item, `resolution.decisions[${index}]`);
    exactKeys(decision, ["groupIds", "canonicalName", "canonicalSlug", "aliases", "confidence"], `resolution.decisions[${index}]`);
    textArray(decision.groupIds, `resolution.decisions[${index}].groupIds`);
    const groupIds = decision.groupIds as string[];
    expect(groupIds.length >= 2, `resolution.decisions[${index}] must merge at least two groups`);
    expect(new Set(groupIds).size === groupIds.length, `resolution.decisions[${index}].groupIds must be unique`);
    groupIds.forEach((id) => {
      expect(knownGroups.has(id), `resolution.decisions[${index}] references unknown group ${id}`);
      expect(!assignedGroups.has(id), `resolution group ${id} appears in multiple decisions`);
      assignedGroups.add(id);
    });
    for (let left = 0; left < groupIds.length; left += 1) {
      for (let right = left + 1; right < groupIds.length; right += 1) {
        expect(allowedPairs.has([groupIds[left], groupIds[right]].sort().join("\0")), `resolution.decisions[${index}] contains a non-candidate merge`);
      }
    }
    text(decision.canonicalName, `resolution.decisions[${index}].canonicalName`);
    text(decision.canonicalSlug, `resolution.decisions[${index}].canonicalSlug`);
    textArray(decision.aliases, `resolution.decisions[${index}].aliases`);
    confidence(decision.confidence, `resolution.decisions[${index}].confidence`);
  });
}

export function assertSynthesizedConceptRelations(
  value: unknown,
  input: CorpusSynthesisInput,
): asserts value is SynthesizedConceptRelation[] {
  expect(Array.isArray(value), "synthesis.relations must be an array");
  const articles = new Map(input.articles.map((article) => [article.id, article]));
  const concepts = new Map(input.concepts.map((concept) => [concept.id, concept]));

  value.forEach((item, index) => {
    const relation = record(item, `synthesis.relations[${index}]`);
    exactKeys(relation, ["kind", "sourceConceptId", "targetConceptId", "confidence", "reasoning", "evidence"], `synthesis.relations[${index}]`);
    expect(["prerequisite", "related", "extends"].includes(relation.kind as string), `synthesis.relations[${index}].kind is invalid`);
    text(relation.sourceConceptId, `synthesis.relations[${index}].sourceConceptId`);
    text(relation.targetConceptId, `synthesis.relations[${index}].targetConceptId`);
    expect(relation.sourceConceptId !== relation.targetConceptId, `synthesis.relations[${index}] cannot be a self-loop`);
    const source = concepts.get(relation.sourceConceptId as string);
    const target = concepts.get(relation.targetConceptId as string);
    expect(source && target, `synthesis.relations[${index}] references an unknown concept`);
    confidence(relation.confidence, `synthesis.relations[${index}].confidence`);
    text(relation.reasoning, `synthesis.relations[${index}].reasoning`);
    expect(Array.isArray(relation.evidence) && relation.evidence.length > 0, `synthesis.relations[${index}].evidence must be non-empty`);
    relation.evidence.forEach((item, evidenceIndex) => {
      const path = `synthesis.relations[${index}].evidence[${evidenceIndex}]`;
      evidence(item, path, articles);
      const quote = record(item, path).quote as string;
      expect(mentions(quote, [source.name, ...source.aliases]) && mentions(quote, [target.name, ...target.aliases]), `${path} must mention both relation endpoints`);
    });
  });
}

export function assertRawArticle(value: unknown, path = "article"): asserts value is RawArticle {
  const article = record(value, path);
  for (const field of ["id", "title", "slug", "publishedAt", "sourceUrl", "content"] as const) {
    text(article[field], `${path}.${field}`);
  }
  expect(!Number.isNaN(Date.parse(article.publishedAt as string)), `${path}.publishedAt must be a date`);
}

export function assertCompiledKnowledgeDataset(value: unknown): asserts value is CompiledKnowledgeDataset {
  const data = record(value, "dataset");
  expect(data.schemaVersion === "1.0", "dataset.schemaVersion must be 1.0");

  const compiler = record(data.compiler, "dataset.compiler");
  text(compiler.mode, "dataset.compiler.mode");
  text(compiler.provider, "dataset.compiler.provider");

  const creator = record(data.creator, "dataset.creator");
  for (const field of ["id", "name", "handle", "bio"] as const) text(creator[field], `dataset.creator.${field}`);
  textArray(creator.focus, "dataset.creator.focus");
  textArray(creator.articleIds, "dataset.creator.articleIds");

  expect(Array.isArray(data.articles) && data.articles.length > 0, "dataset.articles must be non-empty");
  data.articles.forEach((value, index) => {
    const article = record(value, `dataset.articles[${index}]`);
    for (const field of ["id", "title", "slug", "summary", "publishedAt", "sourceUrl"] as const) {
      text(article[field], `dataset.articles[${index}].${field}`);
    }
    expect(Number.isInteger(article.readingTimeMinutes) && Number(article.readingTimeMinutes) > 0, `dataset.articles[${index}].readingTimeMinutes must be a positive integer`);
  });

  expect(Array.isArray(data.concepts) && data.concepts.length > 0, "dataset.concepts must be non-empty");
  data.concepts.forEach((value, index) => {
    const concept = record(value, `dataset.concepts[${index}]`);
    for (const field of ["id", "name", "slug", "summary", "domain"] as const) text(concept[field], `dataset.concepts[${index}].${field}`);
    expect(["foundation", "intermediate", "advanced"].includes(concept.level as string), `dataset.concepts[${index}].level is invalid`);
    if (concept.parentId !== undefined) text(concept.parentId, `dataset.concepts[${index}].parentId`);
    textArray(concept.aliases, `dataset.concepts[${index}].aliases`);
    textArray(concept.evidenceArticleIds, `dataset.concepts[${index}].evidenceArticleIds`);
    confidence(concept.confidence, `dataset.concepts[${index}].confidence`);
  });

  expect(Array.isArray(data.relations), "dataset.relations must be an array");
  data.relations.forEach((value, index) => {
    const relation = record(value, `dataset.relations[${index}]`);
    for (const field of ["id", "sourceId", "targetId"] as const) text(relation[field], `dataset.relations[${index}].${field}`);
    expect(["article-concept", "prerequisite", "related", "extends"].includes(relation.kind as string), `dataset.relations[${index}].kind is invalid`);
    confidence(relation.confidence, `dataset.relations[${index}].confidence`);
    expect(Array.isArray(relation.evidence) && relation.evidence.length > 0, `dataset.relations[${index}].evidence must be non-empty`);
    relation.evidence.forEach((value, evidenceIndex) => {
      const evidence = record(value, `dataset.relations[${index}].evidence[${evidenceIndex}]`);
      text(evidence.articleId, `dataset.relations[${index}].evidence[${evidenceIndex}].articleId`);
      text(evidence.quote, `dataset.relations[${index}].evidence[${evidenceIndex}].quote`);
      if (evidence.startOffset !== undefined || evidence.endOffset !== undefined) {
        expect(Number.isInteger(evidence.startOffset) && Number(evidence.startOffset) >= 0, `dataset.relations[${index}].evidence[${evidenceIndex}].startOffset must be a non-negative integer`);
        expect(Number.isInteger(evidence.endOffset) && Number(evidence.endOffset) > Number(evidence.startOffset), `dataset.relations[${index}].evidence[${evidenceIndex}].endOffset must follow startOffset`);
      }
      if (evidence.supportScore !== undefined) {
        confidence(evidence.supportScore, `dataset.relations[${index}].evidence[${evidenceIndex}].supportScore`);
      }
    });
    if (relation.reasoning !== undefined) text(relation.reasoning, `dataset.relations[${index}].reasoning`);
  });

  expect(Array.isArray(data.readingPaths), "dataset.readingPaths must be an array");
  data.readingPaths.forEach((value, index) => {
    const path = record(value, `dataset.readingPaths[${index}]`);
    for (const field of ["id", "title", "summary"] as const) text(path[field], `dataset.readingPaths[${index}].${field}`);
    expect(["beginner", "intermediate", "advanced"].includes(path.level as string), `dataset.readingPaths[${index}].level is invalid`);
    textArray(path.conceptIds, `dataset.readingPaths[${index}].conceptIds`);
    textArray(path.articleIds, `dataset.readingPaths[${index}].articleIds`);
  });
}
