import type { Concept } from "@/data/models";
import type { ArticleExtraction } from "./provider.ts";

export function normalizeConcepts(extractions: ArticleExtraction[]): Concept[] {
  const groups = new Map<string, ArticleExtraction["concepts"]>();

  for (const candidate of extractions.flatMap(({ concepts }) => concepts)) {
    const group = groups.get(candidate.slug) ?? [];
    group.push(candidate);
    groups.set(candidate.slug, group);
  }

  const idBySlug = new Map([...groups.keys()].map((slug) => [slug, `concept-${slug}`]));
  return [...groups.entries()]
    .map(([slug, candidates]) => {
      const first = candidates[0];
      return {
        id: idBySlug.get(slug)!,
        name: first.name,
        slug,
        summary: first.summary,
        domain: first.domain,
        level: first.level,
        ...(first.parentSlug && idBySlug.has(first.parentSlug)
          ? { parentId: idBySlug.get(first.parentSlug) }
          : {}),
        aliases: [...new Set(candidates.flatMap(({ aliases }) => aliases))].sort(),
        evidenceArticleIds: [...new Set(candidates.map(({ evidence }) => evidence.articleId))].sort(),
        confidence: Number(
          (candidates.reduce((sum, { confidence }) => sum + confidence, 0) / candidates.length).toFixed(2),
        ),
      } satisfies Concept;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
