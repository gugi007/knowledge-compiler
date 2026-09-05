import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Creator } from "../data/models.ts";
import {
  compileKnowledge,
  createCompilerProvider,
  ingestArticles,
} from "../lib/compiler/index.ts";
import { assertCompiledKnowledgeDataset } from "../lib/compiler/schema.ts";

const demoDirectory = resolve(process.env.DATA_DIR ?? "data/demo");
const creator = JSON.parse(await readFile(resolve(demoDirectory, "creator.json"), "utf8")) as Creator;
const articles = await ingestArticles(resolve(demoDirectory, "articles"));
const dataset = await compileKnowledge({
  creator,
  articles,
  provider: createCompilerProvider(),
});
assertCompiledKnowledgeDataset(dataset);
await writeFile(resolve(demoDirectory, "compiled.json"), `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

console.log(
  `Compiled ${dataset.articles.length} articles into ${dataset.concepts.length} concepts and ${dataset.relations.length} relations (${dataset.compiler.mode}).`,
);
