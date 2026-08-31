import type { Article, Concept, ReadingPath, Relation } from "@/data/models";

const levelRank = { foundation: 0, intermediate: 1, advanced: 2 } as const;

function topologicalOrder(concepts: Concept[], relations: Relation[]) {
  const conceptIds = new Set(concepts.map(({ id }) => id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(concepts.map(({ id }) => [id, 0]));

  for (const relation of relations) {
    if (
      relation.kind !== "prerequisite" ||
      !conceptIds.has(relation.sourceId) ||
      !conceptIds.has(relation.targetId)
    ) continue;
    outgoing.set(relation.sourceId, [...(outgoing.get(relation.sourceId) ?? []), relation.targetId]);
    indegree.set(relation.targetId, (indegree.get(relation.targetId) ?? 0) + 1);
  }

  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
  const ready = concepts.filter(({ id }) => indegree.get(id) === 0);
  const ordered: Concept[] = [];
  const sortReady = () => ready.sort((a, b) => levelRank[a.level] - levelRank[b.level] || a.id.localeCompare(b.id));
  sortReady();

  while (ready.length) {
    const concept = ready.shift()!;
    ordered.push(concept);
    for (const targetId of outgoing.get(concept.id) ?? []) {
      indegree.set(targetId, indegree.get(targetId)! - 1);
      if (indegree.get(targetId) === 0) ready.push(conceptById.get(targetId)!);
    }
    sortReady();
  }

  if (ordered.length !== concepts.length) throw new Error("Cannot generate reading paths from cyclic prerequisites");
  return ordered;
}

export function generateReadingPaths(
  concepts: Concept[],
  articles: Article[],
  relations: Relation[],
): ReadingPath[] {
  const ordered = topologicalOrder(concepts, relations);
  const specs = [
    { id: "path-llm-foundations", title: "理解 LLM 的骨架", summary: "从模型整体进入 Transformer、Attention 与位置表示。", level: "beginner" as const, domains: ["模型基础", "注意力机制"] },
    { id: "path-inference-systems", title: "高吞吐推理工程", summary: "沿着服务、缓存、调度与优化理解推理系统。", level: "intermediate" as const, domains: ["推理系统"] },
    { id: "path-long-context", title: "走向长上下文", summary: "从窗口边界进入位置外推、缓存成本与检索互补。", level: "advanced" as const, domains: ["长上下文"] },
  ];
  const articleById = new Map(articles.map((article) => [article.id, article]));

  return specs.flatMap((spec) => {
    const conceptIds = ordered.filter(({ domain }) => spec.domains.includes(domain)).map(({ id }) => id);
    if (!conceptIds.length) return [];
    const included = new Set(conceptIds);
    const articleIds = [...new Set(
      relations
        .filter(({ kind, targetId }) => kind === "article-concept" && included.has(targetId))
        .map(({ sourceId }) => sourceId),
    )].sort((a, b) => articleById.get(a)!.publishedAt.localeCompare(articleById.get(b)!.publishedAt));
    return [{ ...spec, conceptIds, articleIds }];
  });
}
