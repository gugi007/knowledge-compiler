import type { CompiledKnowledgeDataset } from "@/data/models";

/**
 * 时间轴回放：纯派生，不需要任何新的编译。
 * 已核对数据形状可行——Article.publishedAt 是 ISO 字符串可字典序比较，
 * Concept.evidenceArticleIds 构造上非空，Relation.evidence 非空。
 */

/** 滑块刻度：去重排序后的 publishedAt。 */
export function timelineSteps(dataset: CompiledKnowledgeDataset): string[] {
  return [...new Set(dataset.articles.map(({ publishedAt }) => publishedAt))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * 取 cutoff 时刻的知识网络切片。纳入规则：
 * - 文章：publishedAt <= cutoff
 * - 概念：min(evidenceArticleIds 各篇的 publishedAt) <= cutoff
 * - 关系：两端都纳入，且 min(evidence[].articleId 各篇的 publishedAt) <= cutoff
 * - readingPaths：按存活的 conceptIds 过滤，剩不到 2 个概念的整条丢弃
 *   （不重算路径，避免与 generate-reading-paths.ts 形成依赖）
 *
 * 调用顺序是 datasetAt(applyOverlay(dataset, overlay), cutoff)，
 * 这样合并与重命名在每一帧内部都保持 id 一致。
 *
 * 三个必须如实标注、不能当成 bug 藏起来的帧：
 * 1. 基础概念如果首次被写到很晚，就会出现得很晚——口径是「以首次被写到的时间为准」；
 * 2. 跨文章关系会在较晚那篇的时间点出现、却引用较早那篇的句子。这正是「旧文章被
 *    重新连接」的故事，但 UI 要显示引文自己的日期；
 * 3. 早期帧带着最终的全局领域配色——分类是文集级的，存在时代错置。
 */
export function datasetAt(
  dataset: CompiledKnowledgeDataset,
  cutoff: string,
): CompiledKnowledgeDataset {
  const dateById = new Map(dataset.articles.map(({ id, publishedAt }) => [id, publishedAt]));
  const earliest = (ids: readonly string[]): string | undefined => {
    let min: string | undefined;
    for (const id of ids) {
      const date = dateById.get(id);
      if (date && (min === undefined || date < min)) min = date;
    }
    return min;
  };

  const articles = dataset.articles.filter(({ publishedAt }) => publishedAt <= cutoff);
  const articleIds = new Set(articles.map(({ id }) => id));
  const concepts = dataset.concepts.filter((concept) => {
    const first = earliest(concept.evidenceArticleIds);
    return first !== undefined && first <= cutoff;
  });
  const conceptIds = new Set(concepts.map(({ id }) => id));
  const relations = dataset.relations.filter((relation) => {
    const endpointsIn = relation.kind === "article-concept"
      ? articleIds.has(relation.sourceId) && conceptIds.has(relation.targetId)
      : conceptIds.has(relation.sourceId) && conceptIds.has(relation.targetId);
    if (!endpointsIn) return false;
    const first = earliest(relation.evidence.map(({ articleId }) => articleId));
    // evidence 构造上非空；为空时退化为只看端点，不静默丢整条关系。
    return first === undefined || first <= cutoff;
  });
  const readingPaths = dataset.readingPaths
    .map((path) => ({ ...path, conceptIds: path.conceptIds.filter((id) => conceptIds.has(id)) }))
    .filter((path) => path.conceptIds.length >= 2);

  return {
    ...dataset,
    creator: { ...dataset.creator, articleIds: articles.map(({ id }) => id) },
    articles,
    concepts,
    relations,
    readingPaths,
  };
}
