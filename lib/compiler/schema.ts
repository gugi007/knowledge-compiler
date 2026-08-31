import type { CompiledKnowledgeDataset, RawArticle } from "@/data/models";

type UnknownRecord = Record<string, unknown>;

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function record(value: unknown, path: string): UnknownRecord {
  expect(typeof value === "object" && value !== null && !Array.isArray(value), `${path} must be an object`);
  return value as UnknownRecord;
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
