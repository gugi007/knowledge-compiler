import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RawArticle } from "@/data/models";
import { assertRawArticle } from "./schema.ts";

export async function ingestArticles(directory: string): Promise<RawArticle[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const articles: RawArticle[] = [];

  for (const file of files) {
    const value: unknown = JSON.parse(await readFile(join(directory, file), "utf8"));
    const entries = Array.isArray(value) ? value : [value];
    entries.forEach((entry, index) => {
      assertRawArticle(entry, `${file}[${index}]`);
      articles.push({ ...entry, content: entry.content.trim() });
    });
  }

  const ids = new Set(articles.map(({ id }) => id));
  if (!articles.length) throw new Error(`No raw articles found in ${directory}`);
  if (ids.size !== articles.length) throw new Error("Raw article IDs must be unique");
  return articles.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
}
