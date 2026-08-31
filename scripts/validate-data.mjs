import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertCompiledKnowledgeDataset,
  assertRawArticle,
} from "../lib/compiler/schema.ts";

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
  }
  for (const evidence of relation.evidence) {
    const article = rawById.get(evidence.articleId);
    assert(article, `relation evidence references missing article: ${evidence.articleId}`);
    assert(
      article.content.includes(evidence.quote) || article.title.includes(evidence.quote),
      `relation evidence quote is not present in ${evidence.articleId}: ${relation.id}`,
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

console.log(
  `Dataset valid: ${data.articles.length} articles, ${data.concepts.length} concepts, ${data.relations.length} relations.`,
);
