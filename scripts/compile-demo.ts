import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Creator } from "../data/models.ts";
import {
  compileKnowledge,
  createCompilerProvider,
  ingestArticles,
} from "../lib/compiler/index.ts";
import { assertCompiledKnowledgeDataset } from "../lib/compiler/schema.ts";

// 防覆写闸：`data/*/compiled.json` 里的基线数据集是人工维护的，而且 mock provider
// 重跑也无法复现同一结果，一旦被裸跑覆写就只能靠 git 恢复（已经踩过两次）。
// 因此已存在目标文件时默认拒绝，必须显式 `--force` 才允许覆盖。
const force = process.argv.slice(2).includes("--force");
const demoDirectory = resolve(process.env.DATA_DIR ?? "data/demo");
const targetPath = resolve(demoDirectory, "compiled.json");
const targetExists = existsSync(targetPath);

console.log(`[compile:demo] target directory : ${demoDirectory}`);
console.log(
  `[compile:demo] target file      : ${targetPath} (${targetExists ? "already exists" : "new file"})`,
);

const provider = createCompilerProvider();
console.log(
  `[compile:demo] provider         : ${provider.name} (mode=${provider.mode}, KNOWLEDGE_COMPILER_PROVIDER=${process.env.KNOWLEDGE_COMPILER_PROVIDER ?? "<unset, defaults to mock>"})`,
);

if (targetExists && !force) {
  const existing = await readExistingCompiler(targetPath);
  console.error(
    [
      `[compile:demo] REFUSED: ${targetPath} already exists and --force was not passed.`,
      "[compile:demo] No file was written.",
      `[compile:demo] Existing file: mode=${existing.mode}, provider=${existing.provider}`,
      `[compile:demo] This run would have overwritten it with mode=${provider.mode}, provider=${provider.name}.`,
      "[compile:demo] To overwrite it deliberately: npm run compile:demo -- --force",
      "[compile:demo] To compile somewhere else instead: DATA_DIR=<dir> npm run compile:demo",
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  const creator = JSON.parse(await readFile(resolve(demoDirectory, "creator.json"), "utf8")) as Creator;
  const articles = await ingestArticles(resolve(demoDirectory, "articles"));
  const dataset = await compileKnowledge({
    creator,
    articles,
    provider,
  });
  assertCompiledKnowledgeDataset(dataset);
  await writeFile(targetPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

  console.log(
    `Compiled ${dataset.articles.length} articles into ${dataset.concepts.length} concepts and ${dataset.relations.length} relations (${dataset.compiler.mode}).`,
  );
  console.log(
    targetExists
      ? `[compile:demo] overwrote existing compiled.json at ${targetPath}`
      : `[compile:demo] wrote new compiled.json at ${targetPath}`,
  );
}

// 读取现有文件里的 compiler 信息，用于拒绝信息；文件损坏时退化为 unknown 而不是抛错。
async function readExistingCompiler(
  path: string,
): Promise<{ mode: string; provider: string }> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      compiler?: { mode?: unknown; provider?: unknown };
    };
    return {
      mode: typeof parsed.compiler?.mode === "string" ? parsed.compiler.mode : "unknown",
      provider: typeof parsed.compiler?.provider === "string" ? parsed.compiler.provider : "unknown",
    };
  } catch {
    return { mode: "unknown", provider: "unknown" };
  }
}
