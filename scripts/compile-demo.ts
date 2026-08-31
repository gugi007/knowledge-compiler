import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Creator } from "../data/models.ts";
import {
  compileKnowledge,
  DeterministicMockProvider,
  ingestArticles,
} from "../lib/compiler/index.ts";
import { assertCompiledKnowledgeDataset } from "../lib/compiler/schema.ts";

const demoDirectory = resolve("data/demo");
const requestedProvider = process.env.KNOWLEDGE_COMPILER_PROVIDER ?? "mock";
if (requestedProvider !== "mock") {
  throw new Error(`Provider "${requestedProvider}" is not configured. Inject an ExtractionProvider in compileKnowledge().`);
}

const creator = JSON.parse(await readFile(resolve(demoDirectory, "creator.json"), "utf8")) as Creator;
const articles = await ingestArticles(resolve(demoDirectory, "articles"));
const dataset = await compileKnowledge({
  creator,
  articles,
  provider: new DeterministicMockProvider(),
});
assertCompiledKnowledgeDataset(dataset);
await writeFile(resolve(demoDirectory, "compiled.json"), `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

console.log(
  `Compiled ${dataset.articles.length} articles into ${dataset.concepts.length} concepts and ${dataset.relations.length} relations (${dataset.compiler.mode}).`,
);
