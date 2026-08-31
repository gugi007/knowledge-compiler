import type { Concept } from "@/data/models";
import type {
  ArticleExtraction,
  ConceptResolutionDecision,
  ConceptResolutionGroup,
  ExtractionProvider,
  ExtractedConceptCandidate,
} from "./provider.ts";

export interface ConceptResolutionResult {
  concepts: Concept[];
  conceptIdByCandidateSlug: Map<string, string>;
}

export function normalizeConceptName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

export function normalizeCanonicalSlug(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function disjointSet(size: number) {
  const parents = Array.from({ length: size }, (_, index) => index);
  const find = (index: number): number => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  return { find, union };
}

function deterministicGroups(extractions: ArticleExtraction[]): ConceptResolutionGroup[] {
  const candidates = extractions.flatMap(({ concepts }) => concepts);
  const { find, union } = disjointSet(candidates.length);
  const ownerByIdentity = new Map<string, number>();

  candidates.forEach((candidate, index) => {
    const identities = [
      `slug:${normalizeCanonicalSlug(candidate.slug)}`,
      ...[candidate.name, ...candidate.aliases].map((name) => `name:${normalizeConceptName(name)}`),
    ];
    for (const identity of identities) {
      const owner = ownerByIdentity.get(identity);
      if (owner === undefined) ownerByIdentity.set(identity, index);
      else union(index, owner);
    }
  });

  const groups = new Map<number, ExtractedConceptCandidate[]>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), candidate]);
  });

  return [...groups.values()]
    .map((group) => {
      const slugs = [...new Set(group.map(({ slug }) => normalizeCanonicalSlug(slug)))].sort();
      return {
        id: `group:${slugs.join("+")}`,
        names: [...new Set(group.map(({ name }) => name))].sort(),
        slugs,
        aliases: [...new Set(group.flatMap(({ aliases }) => aliases))].sort(),
        candidates: group,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function applyProviderResolution(
  groups: ConceptResolutionGroup[],
  decisions: ConceptResolutionDecision[],
) {
  const indexById = new Map(groups.map((group, index) => [group.id, index]));
  const { find, union } = disjointSet(groups.length);

  for (const decision of decisions) {
    if (!decision.groupIds.length) throw new Error("Concept resolution decision must include a groupId");
    const indexes = decision.groupIds.map((id) => {
      const index = indexById.get(id);
      if (index === undefined) throw new Error(`Concept resolution referenced unknown group: ${id}`);
      return index;
    });
    indexes.slice(1).forEach((index) => union(indexes[0], index));
  }

  const merged = new Map<number, ConceptResolutionGroup[]>();
  groups.forEach((group, index) => {
    const root = find(index);
    merged.set(root, [...(merged.get(root) ?? []), group]);
  });

  return [...merged.entries()].map(([root, memberGroups]) => {
    const matchingDecisions = decisions.filter((decision) =>
      decision.groupIds.some((id) => find(indexById.get(id)!) === root),
    );
    const canonicalSlugs = [...new Set(matchingDecisions.flatMap(({ canonicalSlug }) => canonicalSlug ? [normalizeCanonicalSlug(canonicalSlug)] : []))];
    const canonicalNames = [...new Set(matchingDecisions.flatMap(({ canonicalName }) => canonicalName ? [canonicalName] : []))];
    if (canonicalSlugs.length > 1 || canonicalNames.length > 1) {
      throw new Error("Conflicting provider-assisted concept resolution decisions");
    }
    return {
      groups: memberGroups,
      override: {
        canonicalSlug: canonicalSlugs[0],
        canonicalName: canonicalNames[0],
        aliases: [...new Set(matchingDecisions.flatMap(({ aliases }) => aliases ?? []))],
        confidence: matchingDecisions.find(({ confidence }) => confidence !== undefined)?.confidence,
      },
    };
  });
}

export async function normalizeConcepts(
  extractions: ArticleExtraction[],
  provider: ExtractionProvider,
): Promise<ConceptResolutionResult> {
  const groups = deterministicGroups(extractions);
  const decisions = provider.resolveConcepts ? await provider.resolveConcepts({ groups }) : [];
  const resolved = applyProviderResolution(groups, decisions);
  const conceptIdByCandidateSlug = new Map<string, string>();

  const drafts = resolved.map(({ groups: memberGroups, override }) => {
    const candidates = memberGroups.flatMap(({ candidates }) => candidates);
    const representative = [...candidates].sort(
      (a, b) => b.confidence - a.confidence || normalizeConceptName(a.name).localeCompare(normalizeConceptName(b.name)),
    )[0];
    const slug = override.canonicalSlug ?? normalizeCanonicalSlug(representative.slug);
    const name = override.canonicalName ?? representative.name;
    const id = `concept-${slug}`;
    candidates.forEach((candidate) => conceptIdByCandidateSlug.set(normalizeCanonicalSlug(candidate.slug), id));
    const aliases = [...new Set([
      ...candidates.flatMap((candidate) => [candidate.name, ...candidate.aliases]),
      ...override.aliases,
    ])]
      .filter((alias) => normalizeConceptName(alias) !== normalizeConceptName(name))
      .sort();
    return {
      id,
      name,
      slug,
      summary: representative.summary,
      domain: representative.domain,
      level: representative.level,
      parentSlug: candidates.find(({ parentSlug }) => parentSlug)?.parentSlug,
      aliases,
      evidenceArticleIds: [...new Set(candidates.map(({ evidence }) => evidence.articleId))].sort(),
      confidence: Number((override.confidence ?? candidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / candidates.length).toFixed(2)),
    };
  });

  if (new Set(drafts.map(({ id }) => id)).size !== drafts.length) {
    throw new Error("Concept resolution produced duplicate canonical slugs");
  }

  const concepts = drafts.map(({ parentSlug, ...concept }) => ({
    ...concept,
    ...(parentSlug && conceptIdByCandidateSlug.has(normalizeCanonicalSlug(parentSlug))
      ? { parentId: conceptIdByCandidateSlug.get(normalizeCanonicalSlug(parentSlug)) }
      : {}),
  } satisfies Concept)).sort((a, b) => a.id.localeCompare(b.id));

  return { concepts, conceptIdByCandidateSlug };
}
