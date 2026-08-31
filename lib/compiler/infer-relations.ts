import type { Concept, Relation } from "@/data/models";
import type { ArticleExtraction } from "./provider.ts";

export function inferRelations(
  concepts: Concept[],
  extractions: ArticleExtraction[],
): Relation[] {
  const conceptBySlug = new Map(concepts.map((concept) => [concept.slug, concept]));
  const relations: Relation[] = [];

  for (const extraction of extractions) {
    for (const candidate of extraction.concepts) {
      const concept = conceptBySlug.get(candidate.slug);
      if (!concept) continue;
      relations.push({
        id: `article-concept:${extraction.articleId}:${candidate.slug}`,
        kind: "article-concept",
        sourceId: extraction.articleId,
        targetId: concept.id,
        confidence: candidate.confidence,
        evidence: [candidate.evidence],
      });
    }
  }

  const hints = new Map<string, ArticleExtraction["relations"]>();
  for (const hint of extractions.flatMap(({ relations }) => relations)) {
    const key = `${hint.kind}:${hint.sourceSlug}:${hint.targetSlug}`;
    const group = hints.get(key) ?? [];
    group.push(hint);
    hints.set(key, group);
  }

  for (const [key, group] of hints) {
    const first = group[0];
    const source = conceptBySlug.get(first.sourceSlug);
    const target = conceptBySlug.get(first.targetSlug);
    if (!source || !target) continue;
    relations.push({
      id: `concept-relation:${key}`,
      kind: first.kind,
      sourceId: source.id,
      targetId: target.id,
      confidence: Math.max(...group.map(({ confidence }) => confidence)),
      evidence: [...new Map(group.map(({ evidence }) => [evidence.articleId, evidence])).values()],
      reasoning: first.reasoning,
    });
  }

  return relations.sort((a, b) => a.id.localeCompare(b.id));
}
