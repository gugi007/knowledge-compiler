import type { Evidence, Relation } from "@/data/models";
import {
  normalizeCanonicalSlug,
  type ConceptResolutionResult,
} from "./normalize-concepts.ts";
import type {
  ArticleExtraction,
  SynthesizedConceptRelation,
} from "./provider.ts";

// overlay 折叠关系端点时要合并证据，必须与编译器同一份去重逻辑，故导出复用。
export function uniqueEvidence(evidence: Evidence[]) {
  return [...new Map(evidence.map((item) => [
    `${item.articleId}:${item.startOffset ?? ""}:${item.endOffset ?? ""}:${item.quote}`,
    item,
  ])).values()].sort((a, b) =>
    a.articleId.localeCompare(b.articleId) || (a.startOffset ?? 0) - (b.startOffset ?? 0),
  );
}

export function inferArticleConceptRelations(
  resolution: ConceptResolutionResult,
  extractions: ArticleExtraction[],
): Relation[] {
  const grouped = new Map<string, { articleId: string; conceptId: string; confidence: number; evidence: Evidence[] }>();

  for (const extraction of extractions) {
    for (const candidate of extraction.concepts) {
      const conceptId = resolution.conceptIdByCandidateSlug.get(normalizeCanonicalSlug(candidate.slug));
      if (!conceptId) continue;
      const key = `${extraction.articleId}:${conceptId}`;
      const current = grouped.get(key) ?? {
        articleId: extraction.articleId,
        conceptId,
        confidence: 0,
        evidence: [],
      };
      current.confidence = Math.max(current.confidence, candidate.confidence);
      current.evidence.push(candidate.evidence);
      grouped.set(key, current);
    }
  }

  return [...grouped.values()].map((group): Relation => ({
    id: `article-concept:${group.articleId}:${group.conceptId}`,
    kind: "article-concept",
    sourceId: group.articleId,
    targetId: group.conceptId,
    confidence: group.confidence,
    evidence: uniqueEvidence(group.evidence),
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export function inferRelations(
  resolution: ConceptResolutionResult,
  extractions: ArticleExtraction[],
  articleConceptRelations: Relation[],
  corpusRelations: SynthesizedConceptRelation[],
): Relation[] {
  const conceptIds = new Set(resolution.concepts.map(({ id }) => id));
  const grouped = new Map<string, {
    kind: SynthesizedConceptRelation["kind"];
    sourceId: string;
    targetId: string;
    confidence: number;
    evidence: Evidence[];
    reasoning?: string;
  }>();
  const add = (relation: SynthesizedConceptRelation) => {
    if (!conceptIds.has(relation.sourceConceptId) || !conceptIds.has(relation.targetConceptId)) {
      throw new Error("Concept relation references an unresolved concept");
    }
    if (relation.sourceConceptId === relation.targetConceptId) return;
    const [sourceId, targetId] = relation.kind === "related"
      ? [relation.sourceConceptId, relation.targetConceptId].sort()
      : [relation.sourceConceptId, relation.targetConceptId];
    const key = `${relation.kind}:${sourceId}:${targetId}`;
    const current = grouped.get(key);
    grouped.set(key, {
      kind: relation.kind,
      sourceId,
      targetId,
      confidence: Math.max(current?.confidence ?? 0, relation.confidence),
      evidence: uniqueEvidence([...(current?.evidence ?? []), ...relation.evidence]),
      reasoning: relation.reasoning ?? current?.reasoning,
    });
  };

  for (const hint of extractions.flatMap(({ relations }) => relations)) {
    const sourceConceptId = resolution.conceptIdByCandidateSlug.get(normalizeCanonicalSlug(hint.sourceSlug));
    const targetConceptId = resolution.conceptIdByCandidateSlug.get(normalizeCanonicalSlug(hint.targetSlug));
    if (!sourceConceptId || !targetConceptId) continue;
    add({
      kind: hint.kind,
      sourceConceptId,
      targetConceptId,
      confidence: hint.confidence,
      evidence: hint.evidence,
      reasoning: hint.reasoning ?? "由单篇文章中的关系证据推断。",
    });
  }
  corpusRelations.forEach(add);

  const conceptRelations: Relation[] = [...grouped.entries()].map(([key, relation]) => ({
    id: `concept-relation:${key}`,
    ...relation,
  }));
  return [...articleConceptRelations, ...conceptRelations].sort((a, b) => a.id.localeCompare(b.id));
}
