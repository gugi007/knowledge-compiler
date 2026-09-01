import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertCompiledKnowledgeDataset,
  assertRawArticle,
} from "../lib/compiler/schema.ts";
import { normalizeConcepts } from "../lib/compiler/normalize-concepts.ts";
import { inferRelations } from "../lib/compiler/infer-relations.ts";
import { OpenAICompatibleLLMProvider } from "../lib/compiler/llm-provider.ts";
import { createCompilerProvider } from "../lib/compiler/create-provider.ts";

const demoDirectory = resolve("data/demo");
const data = JSON.parse(await readFile(resolve(demoDirectory, "compiled.json"), "utf8"));
assertCompiledKnowledgeDataset(data);

const rawArticles = [];
for (const file of (await readdir(resolve(demoDirectory, "articles"))).filter((name) => name.endsWith(".json")).sort()) {
  const value = JSON.parse(await readFile(resolve(demoDirectory, "articles", file), "utf8"));
  const entries = Array.isArray(value) ? value : [value];
  entries.forEach((article, index) => {
    assertRawArticle(article, `${file}[${index}]`);
    rawArticles.push(article);
  });
}

const rawById = new Map(rawArticles.map((article) => [article.id, article]));
const articleIds = new Set(data.articles.map(({ id }) => id));
const conceptIds = new Set(data.concepts.map(({ id }) => id));
const entityIds = new Set([...articleIds, ...conceptIds]);
const conceptById = new Map(data.concepts.map((concept) => [concept.id, concept]));

function mentionsConcept(quote, concept) {
  return [concept.name, ...concept.aliases].some((term) => {
    if (/\p{Script=Han}/u.test(term)) return quote.includes(term);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(quote);
  });
}

assert.equal(rawById.size, rawArticles.length, "raw article IDs must be unique");
assert.equal(articleIds.size, data.articles.length, "compiled article IDs must be unique");
assert.equal(conceptIds.size, data.concepts.length, "concept IDs must be unique");
assert.equal(entityIds.size, articleIds.size + conceptIds.size, "article and concept IDs must not overlap");
assert.equal(new Set(data.relations.map(({ id }) => id)).size, data.relations.length, "relation IDs must be unique");
assert.deepEqual(new Set(data.creator.articleIds), articleIds, "creator.articleIds must include every compiled article");

for (const article of data.articles) {
  assert(rawById.has(article.id), `compiled article is missing raw input: ${article.id}`);
}

for (const concept of data.concepts) {
  if (concept.parentId) {
    assert(conceptIds.has(concept.parentId), `missing parent concept: ${concept.parentId}`);
    assert.notEqual(concept.id, concept.parentId, `concept cannot parent itself: ${concept.id}`);
  }
  for (const articleId of concept.evidenceArticleIds) {
    assert(articleIds.has(articleId), `concept evidence references missing article: ${articleId}`);
  }
}

for (const relation of data.relations) {
  assert.notEqual(relation.sourceId, relation.targetId, `self-loop relation: ${relation.id}`);
  if (relation.kind === "article-concept") {
    assert(articleIds.has(relation.sourceId), `article-concept source must be an article: ${relation.id}`);
    assert(conceptIds.has(relation.targetId), `article-concept target must be a concept: ${relation.id}`);
  } else {
    assert(conceptIds.has(relation.sourceId), `concept relation source is missing: ${relation.id}`);
    assert(conceptIds.has(relation.targetId), `concept relation target is missing: ${relation.id}`);
    if (relation.kind === "related") {
      assert(relation.sourceId < relation.targetId, `related relation endpoints are not canonical: ${relation.id}`);
    }
  }
  for (const evidence of relation.evidence) {
    const article = rawById.get(evidence.articleId);
    assert(article, `relation evidence references missing article: ${evidence.articleId}`);
    assert(
      article.content.includes(evidence.quote),
      `relation evidence quote is not present in ${evidence.articleId}: ${relation.id}`,
    );
    if (evidence.startOffset !== undefined || evidence.endOffset !== undefined) {
      assert.equal(
        article.content.slice(evidence.startOffset, evidence.endOffset),
        evidence.quote,
        `relation evidence offsets do not match quote: ${relation.id}`,
      );
    }
  }
  const sourceConcept = conceptById.get(relation.sourceId);
  const targetConcept = conceptById.get(relation.targetId);
  if (relation.kind === "article-concept") {
    assert(
      relation.evidence.some(({ quote }) => mentionsConcept(quote, targetConcept)),
      `article-concept evidence does not mention its concept: ${relation.id}`,
    );
  } else {
    assert(
      relation.evidence.some(({ quote }) =>
        mentionsConcept(quote, sourceConcept) && mentionsConcept(quote, targetConcept),
      ),
      `concept relation evidence must mention both endpoints: ${relation.id}`,
    );
  }
}

const prerequisiteGraph = new Map([...conceptIds].map((id) => [id, []]));
for (const relation of data.relations.filter(({ kind }) => kind === "prerequisite")) {
  prerequisiteGraph.get(relation.sourceId).push(relation.targetId);
}
const state = new Map();
function visit(id) {
  assert.notEqual(state.get(id), "visiting", `prerequisite cycle detected at ${id}`);
  if (state.get(id) === "visited") return;
  state.set(id, "visiting");
  prerequisiteGraph.get(id).forEach(visit);
  state.set(id, "visited");
}
conceptIds.forEach(visit);

for (const path of data.readingPaths) {
  assert(path.conceptIds.length > 0, `reading path has no concepts: ${path.id}`);
  assert(path.articleIds.length > 0, `reading path has no articles: ${path.id}`);
  assert.equal(new Set(path.conceptIds).size, path.conceptIds.length, `duplicate concept in reading path: ${path.id}`);
  assert.equal(new Set(path.articleIds).size, path.articleIds.length, `duplicate article in reading path: ${path.id}`);
  path.conceptIds.forEach((id) => assert(conceptIds.has(id), `reading path references missing concept: ${id}`));
  path.articleIds.forEach((id) => assert(articleIds.has(id), `reading path references missing article: ${id}`));
}

const conceptCandidate = (name, slug, aliases, articleId) => ({
  name,
  slug,
  aliases,
  summary: `${name} fixture`,
  domain: "fixture",
  level: "foundation",
  confidence: 0.9,
  evidence: { articleId, quote: name },
});
const hardResolution = await normalizeConcepts([
  { articleId: "fixture-a", concepts: [conceptCandidate("KV Cache", "kv-cache", ["键值缓存"], "fixture-a")], relations: [] },
  { articleId: "fixture-b", concepts: [conceptCandidate("kv cache", "key-value-cache", ["缓存"], "fixture-b")], relations: [] },
], {});
assert.equal(hardResolution.concepts.length, 1, "deterministic resolution must merge identical canonical names");

let aliasCandidates = [];
const ambiguousAliasExtractions = [
  { articleId: "fixture-rag", concepts: [conceptCandidate("RAG", "rag", ["检索"], "fixture-rag")], relations: [] },
  { articleId: "fixture-retrieval", concepts: [conceptCandidate("Context Retrieval", "context-retrieval", ["检索"], "fixture-retrieval")], relations: [] },
];
const ambiguousAliasResolution = await normalizeConcepts(ambiguousAliasExtractions, {
  resolveConcepts: async ({ candidatePairs }) => {
    aliasCandidates = candidatePairs;
    return [];
  },
});
assert.equal(ambiguousAliasResolution.concepts.length, 2, "shared generic aliases must not hard-merge concepts");
assert.equal(aliasCandidates.length, 1, "shared aliases must be offered as provider merge candidates");

const providerResolution = await normalizeConcepts([
  { articleId: "fixture-c", concepts: [conceptCandidate("Serving Layer", "serving-layer", ["Model Serving"], "fixture-c")], relations: [] },
  { articleId: "fixture-d", concepts: [conceptCandidate("Inference Gateway", "inference-gateway", ["Model Serving"], "fixture-d")], relations: [] },
], {
  resolveConcepts: async ({ candidatePairs }) => [{
    groupIds: candidatePairs[0].groupIds,
    canonicalName: "Model Serving",
    canonicalSlug: "model-serving",
  }],
});
assert.equal(providerResolution.concepts[0]?.id, "concept-model-serving", "provider-assisted resolution must control canonical identity");

const [leftConcept, rightConcept] = data.concepts.slice(0, 2);
const reverseRelated = inferRelations(
  { concepts: [leftConcept, rightConcept], conceptIdByCandidateSlug: new Map() },
  [],
  [],
  [
    { kind: "related", sourceConceptId: leftConcept.id, targetConceptId: rightConcept.id, confidence: 0.8, reasoning: "fixture", evidence: data.relations[0].evidence },
    { kind: "related", sourceConceptId: rightConcept.id, targetConceptId: leftConcept.id, confidence: 0.9, reasoning: "fixture", evidence: data.relations[0].evidence },
  ],
);
assert.equal(reverseRelated.length, 1, "reverse related relations must canonicalize to one relation");
assert(reverseRelated[0].sourceId < reverseRelated[0].targetId, "related relation must use canonical endpoint order");

const llmFixtureArticle = {
  id: "fixture-llm",
  title: "RAG basics",
  slug: "rag-basics",
  publishedAt: "2026-01-01",
  sourceUrl: "https://example.com/rag-basics",
  content: "RAG combines retrieval with generation.",
};
const llmFixtureOutput = {
  articleId: llmFixtureArticle.id,
  concepts: [{
    name: "RAG",
    slug: "rag",
    summary: "Retrieval-augmented generation.",
    domain: "AI",
    level: "foundation",
    aliases: ["Retrieval-Augmented Generation"],
    confidence: 0.95,
    evidence: { articleId: llmFixtureArticle.id, quote: llmFixtureArticle.content, supportScore: 0.95 },
  }],
  relations: [],
};
const llmFixtureProvider = new OpenAICompatibleLLMProvider({
  baseUrl: "https://llm.example/v1",
  apiKey: "fixture-key",
  model: "fixture-model",
  fetchImpl: async (url, init) => {
    assert.equal(url, "https://llm.example/v1/chat/completions", "LLM provider must use Chat Completions endpoint");
    assert.equal(init.headers.authorization, "Bearer fixture-key", "LLM provider must send bearer authentication");
    return Response.json({ choices: [{ message: { content: JSON.stringify(llmFixtureOutput) } }] });
  },
});
assert.equal((await llmFixtureProvider.extract(llmFixtureArticle)).concepts[0].slug, "rag", "LLM provider must validate and return extraction JSON");
assert.throws(
  () => createCompilerProvider({ KNOWLEDGE_COMPILER_PROVIDER: "llm" }),
  /requires LLM_BASE_URL, LLM_API_KEY, LLM_MODEL/,
  "LLM mode must report missing configuration clearly",
);

console.log(
  `Dataset valid: ${data.articles.length} articles, ${data.concepts.length} concepts, ${data.relations.length} relations.`,
);
