import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const data = JSON.parse(
  await readFile(new URL("../data/demo.json", import.meta.url), "utf8"),
);
const ids = new Set([
  data.creator.id,
  ...data.articles.map(({ id }) => id),
  ...data.concepts.map(({ id }) => id),
]);

assert.equal(data.articles.length, 18);
assert.equal(data.concepts.length, 15);
assert.equal(ids.size, 34, "article, concept and creator IDs must be unique");
for (const relation of data.relations) {
  assert(ids.has(relation.sourceId), `missing source: ${relation.sourceId}`);
  assert(ids.has(relation.targetId), `missing target: ${relation.targetId}`);
}
for (const path of data.readingPaths) {
  for (const id of [...path.conceptIds, ...path.articleIds]) {
    assert(ids.has(id), `missing reading path item: ${id}`);
  }
}

console.log("Dataset valid: 18 articles, 15 concepts, all references resolved.");
