import type { CompiledKnowledgeDataset, Concept, Relation } from "@/data/models";
// 值导入走相对路径：这些模块也会被 node 原生 TS 脚本（scripts/）直接加载，
// @ 别名只有 bundler / tsc 认识。类型导入不受影响，保留 @ 写法。
import { RELATION_VERB_PROJECTIONS } from "../../data/overlay.ts";
import type {
  ConceptKey,
  EditOverlay,
  OverlayAnnotations,
  OverlayEntry,
  RelationKey,
  ViewpointMark,
} from "../../data/overlay.ts";
import { normalizeConceptName } from "../compiler/normalize-concepts.ts";
import { uniqueEvidence } from "../compiler/infer-relations.ts";

/**
 * 把 overlay 折叠到 dataset 上，产出仍然是合法的 CompiledKnowledgeDataset，
 * 所以现有渲染器与 assertCompiledKnowledgeDataset 都不用改。
 *
 * 纯函数、不落盘、不改入参。compiled.json 永远是纯编译产物。
 */

/**
 * 按 id → name/aliases → slug 的顺序解析概念。
 * 解析不到返回 undefined，调用方据此让这条修改静默 no-op ——
 * 这正是 overlay 能活过一次全量重编译（概念 id 会随 LLM 选的 slug 改名）的原因。
 */
export function resolveConceptKey(
  dataset: CompiledKnowledgeDataset,
  key: ConceptKey,
): Concept | undefined {
  return resolveIn(dataset.concepts, key);
}

function resolveIn(concepts: Concept[], key: ConceptKey): Concept | undefined {
  if (key.id) {
    const byId = concepts.find((concept) => concept.id === key.id);
    if (byId) return byId;
  }
  const anchor = normalizeConceptName(key.name);
  const byName = concepts.find(
    (concept) =>
      normalizeConceptName(concept.name) === anchor ||
      concept.aliases.some((alias) => normalizeConceptName(alias) === anchor),
  );
  if (byName) return byName;
  if (key.slug) {
    return concepts.find((concept) => concept.slug === key.slug);
  }
  return undefined;
}

/** 端点解析成功后按 id → 端点 + kindAtEdit 兜底定位关系。 */
export function resolveRelationKey(
  dataset: CompiledKnowledgeDataset,
  key: RelationKey,
): Relation | undefined {
  return resolveRelationIn(dataset.relations, dataset.concepts, key);
}

function resolveRelationIn(
  relations: Relation[],
  concepts: Concept[],
  key: RelationKey,
): Relation | undefined {
  if (key.id) {
    const byId = relations.find((relation) => relation.id === key.id);
    if (byId) return byId;
  }
  // id 快照失效（重编译改了 id）时，端点用概念锚点解析，再按 kind + 端点集合匹配。
  const source = resolveIn(concepts, key.source);
  const target = resolveIn(concepts, key.target);
  if (!source || !target) return undefined;
  const spans = (relation: Relation) =>
    (relation.sourceId === source.id && relation.targetId === target.id) ||
    (relation.sourceId === target.id && relation.targetId === source.id);
  const exact = relations.find((relation) => relation.kind === key.kindAtEdit && spans(relation));
  if (exact) return exact;
  // 末级兜底：端点相同但 kind 已变（典型场景：一条 retype 重算了 id，
  // 后续 confirm 或批注解析还要找回同一条关系）。kindAtEdit 优先保证不串台。
  return relations.find(spans);
}

/**
 * cancels 只允许指向更早的下标（schema 校验保证），因此倒序一趟就是不动点：
 * 一个取消条目本身被取消时，它的取消不生效（撤销的撤销 = 恢复）。
 */
function activeMask(entries: OverlayEntry[]): boolean[] {
  const active = entries.map(() => true);
  for (let j = entries.length - 1; j >= 0; j -= 1) {
    if (!active[j]) continue;
    const entry = entries[j] as { cancels?: number };
    if (typeof entry.cancels === "number") active[entry.cancels] = false;
  }
  return active;
}

/** 端点重定向或重类型可能撞出同 id 关系，按编译器的口径合并。 */
function dedupeRelations(relations: Relation[]): Relation[] {
  const grouped = new Map<string, Relation>();
  for (const relation of relations) {
    const existing = grouped.get(relation.id);
    if (!existing) {
      grouped.set(relation.id, relation);
      continue;
    }
    grouped.set(relation.id, {
      ...existing,
      confidence: Math.max(existing.confidence, relation.confidence),
      evidence: uniqueEvidence([...existing.evidence, ...relation.evidence]),
      reasoning: existing.reasoning ?? relation.reasoning,
    });
  }
  return [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function applyOverlay(
  dataset: CompiledKnowledgeDataset,
  overlay?: EditOverlay,
): CompiledKnowledgeDataset {
  if (!overlay || overlay.entries.length === 0) return dataset;
  const active = activeMask(overlay.entries);

  let concepts = dataset.concepts.map((concept) => ({
    ...concept,
    aliases: [...concept.aliases],
    evidenceArticleIds: [...concept.evidenceArticleIds],
  }));
  let relations = dataset.relations.map((relation) => ({ ...relation, evidence: [...relation.evidence] }));
  const readingPaths = dataset.readingPaths.map((path) => ({
    ...path,
    conceptIds: [...path.conceptIds],
    articleIds: [...path.articleIds],
  }));

  overlay.entries.forEach((entry, index) => {
    if (!active[index]) return;
    switch (entry.op) {
      case "merge-concepts": {
        const survivor = resolveIn(concepts, entry.keep);
        if (!survivor) break;
        const removedIds = new Set<string>();
        for (const key of entry.merged) {
          const victim = resolveIn(concepts, key);
          if (!victim || victim.id === survivor.id || removedIds.has(victim.id)) continue;
          removedIds.add(victim.id);
          survivor.aliases = [...new Set([...survivor.aliases, victim.name, ...victim.aliases])];
          survivor.evidenceArticleIds = [
            ...new Set([...survivor.evidenceArticleIds, ...victim.evidenceArticleIds]),
          ];
        }
        if (removedIds.size === 0) break;
        concepts = concepts.filter((concept) => !removedIds.has(concept.id));
        for (const concept of concepts) {
          if (concept.parentId && removedIds.has(concept.parentId)) concept.parentId = survivor.id;
        }
        if (survivor.parentId && removedIds.has(survivor.parentId)) survivor.parentId = undefined;
        if (survivor.parentId === survivor.id) survivor.parentId = undefined;
        relations = relations
          .map((relation) => {
            const sourceId = removedIds.has(relation.sourceId) ? survivor.id : relation.sourceId;
            const targetId = removedIds.has(relation.targetId) ? survivor.id : relation.targetId;
            if (sourceId === relation.sourceId && targetId === relation.targetId) return relation;
            return { ...relation, sourceId, targetId };
          })
          .filter((relation) => relation.sourceId !== relation.targetId);
        relations = dedupeRelations(relations);
        for (const path of readingPaths) {
          path.conceptIds = [
            ...new Set(path.conceptIds.map((id) => (removedIds.has(id) ? survivor.id : id))),
          ];
        }
        break;
      }
      case "rename-concept": {
        const target = resolveIn(concepts, entry.target);
        if (!target || !entry.newName.trim()) break;
        // 旧名必须压进 aliases：证据锚定与 mentionsConcept 都按 name+aliases 匹配，
        // 否则旧引文会失锚。
        if (normalizeConceptName(entry.newName) !== normalizeConceptName(target.name)) {
          target.aliases = [...new Set([...target.aliases, target.name])];
        }
        target.name = entry.newName.trim();
        break;
      }
      case "retype-relation": {
        // 动词只投影到概念间 kind；article-concept 的端点是文章，改类型会产出非法 id。
        if (entry.target.kindAtEdit === "article-concept") break;
        const target = resolveRelationIn(relations, concepts, entry.target);
        if (!target || target.kind === "article-concept") break;
        const projection = RELATION_VERB_PROJECTIONS[entry.verb];
        let [sourceId, targetId] = [target.sourceId, target.targetId];
        if (projection.flipsDirection) [sourceId, targetId] = [targetId, sourceId];
        if (projection.undirected) [sourceId, targetId] = [sourceId, targetId].sort();
        relations = relations.filter((relation) => relation.id !== target.id);
        relations.push({
          ...target,
          kind: projection.kind,
          sourceId,
          targetId,
          id: `concept-relation:${projection.kind}:${sourceId}:${targetId}`,
        });
        relations = dedupeRelations(relations);
        break;
      }
      case "delete-relation": {
        const target = resolveRelationIn(relations, concepts, entry.target);
        if (!target) break;
        relations = relations.filter((relation) => relation.id !== target.id);
        break;
      }
      // confirm-relation / mark-viewpoint 不动 dataset，由 readOverlayAnnotations 供渲染层读取；
      // split-concepts / restore-relation 只通过 cancels 生效（activeMask 已处理），折叠时无额外动作。
      case "confirm-relation":
      case "mark-viewpoint":
      case "split-concepts":
      case "restore-relation":
        break;
    }
  });

  return {
    ...dataset,
    concepts,
    relations,
    readingPaths: readingPaths.filter((path) => path.conceptIds.length >= 1),
  };
}

/** 解析出渲染层要的批注（已确认的关系、观点标记、作者选的动词）。 */
export function readOverlayAnnotations(
  dataset: CompiledKnowledgeDataset,
  overlay?: EditOverlay,
): OverlayAnnotations {
  const annotations: OverlayAnnotations = {
    confirmedRelationIds: [],
    viewpoints: [],
    verbs: [],
    mergedAwayNames: [],
  };
  if (!overlay || overlay.entries.length === 0) return annotations;
  const active = activeMask(overlay.entries);
  const verbsByRelation = new Map<string, OverlayAnnotations["verbs"][number]["verb"]>();

  overlay.entries.forEach((entry, index) => {
    if (!active[index]) return;
    switch (entry.op) {
      case "confirm-relation": {
        const relation = resolveRelationKey(dataset, entry.target);
        if (relation && !annotations.confirmedRelationIds.includes(relation.id)) {
          annotations.confirmedRelationIds.push(relation.id);
        }
        break;
      }
      case "retype-relation": {
        const relation = resolveRelationKey(dataset, entry.target);
        // 后写覆盖先写：时间线靠后条目的动词是当前意图。
        if (relation) verbsByRelation.set(relation.id, entry.verb);
        break;
      }
      case "mark-viewpoint": {
        const concept = resolveConceptKey(dataset, entry.target);
        if (concept) {
          const mark: ViewpointMark = { conceptId: concept.id, at: entry.at };
          if (entry.note) mark.note = entry.note;
          annotations.viewpoints.push(mark);
        }
        break;
      }
      case "merge-concepts": {
        for (const key of entry.merged) {
          // 最终 dataset 里解析不到 = 确实被合并掉了；解析得到说明锚撞上了别的概念，不误报。
          if (!resolveConceptKey(dataset, key)) {
            if (!annotations.mergedAwayNames.includes(key.name)) {
              annotations.mergedAwayNames.push(key.name);
            }
          }
        }
        break;
      }
      default:
        break;
    }
  });

  annotations.verbs = [...verbsByRelation.entries()].map(([relationId, verb]) => ({ relationId, verb }));
  annotations.viewpoints.sort(
    (a, b) => a.at.localeCompare(b.at) || a.conceptId.localeCompare(b.conceptId),
  );
  return annotations;
}
