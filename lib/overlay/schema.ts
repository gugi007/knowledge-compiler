// 值导入走相对路径，理由同 apply-overlay.ts。
import { RELATION_VERB_PROJECTIONS } from "../../data/overlay.ts";
import type { EditOverlay } from "../../data/overlay.ts";

/**
 * EditOverlay 的运行时校验，风格与 lib/compiler/schema.ts 一致。
 * overlay 来自 HTTP 请求体与磁盘文件，两处都算系统边界，必须校验。
 */

const RELATION_KINDS: readonly string[] = ["article-concept", "prerequisite", "related", "extends"];
const OPS = [
  "merge-concepts",
  "split-concepts",
  "rename-concept",
  "confirm-relation",
  "retype-relation",
  "delete-relation",
  "restore-relation",
  "mark-viewpoint",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, path: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path}.${field} must be a non-empty string`);
  }
  return value;
}

function optStr(value: unknown, path: string, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${path}.${field} must be a string when present`);
  }
  return value;
}

function assertConceptKey(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  str(value.name, path, "name");
  optStr(value.id, path, "id");
  optStr(value.slug, path, "slug");
}

function assertRelationKey(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  optStr(value.id, path, "id");
  assertConceptKey(value.source, `${path}.source`);
  assertConceptKey(value.target, `${path}.target`);
  const kind = str(value.kindAtEdit, path, "kindAtEdit");
  if (!RELATION_KINDS.includes(kind)) {
    throw new Error(`${path}.kindAtEdit must be one of ${RELATION_KINDS.join(", ")}`);
  }
}

/** 结构校验但不查证据锚定细节：archivedRelation 是作者视图的快照。 */
function assertArchivedRelation(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  str(value.id, path, "id");
  str(value.sourceId, path, "sourceId");
  str(value.targetId, path, "targetId");
  const kind = str(value.kind, path, "kind");
  if (!RELATION_KINDS.includes(kind)) {
    throw new Error(`${path}.kind must be one of ${RELATION_KINDS.join(", ")}`);
  }
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    throw new Error(`${path}.confidence must be a number in [0,1]`);
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    throw new Error(`${path}.evidence must be a non-empty array`);
  }
  value.evidence.forEach((item, index) => {
    if (!isRecord(item)) throw new Error(`${path}.evidence[${index}] must be an object`);
    str(item.articleId, `${path}.evidence[${index}]`, "articleId");
    str(item.quote, `${path}.evidence[${index}]`, "quote");
  });
}

/**
 * 校验单条 entry。maxCancels 用于在「已知当前条目数」的场景收紧 cancels 上界；
 * cancels 只允许指向更早的下标，这是 activeMask 单趟不动点成立的前提。
 */
function assertEntryShape(
  value: unknown,
  path: string,
  options: { requireAt: boolean; cancelsUpperBound?: number },
): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  const op = value.op;
  if (typeof op !== "string" || !(OPS as readonly string[]).includes(op)) {
    throw new Error(`${path}.op must be one of ${OPS.join(", ")}`);
  }
  if (options.requireAt || value.at !== undefined) {
    str(value.at, path, "at");
  }
  const hasCancels = op === "split-concepts" || op === "restore-relation";
  if (hasCancels) {
    if (typeof value.cancels !== "number" || !Number.isInteger(value.cancels) || value.cancels < 0) {
      throw new Error(`${path}.cancels must be a non-negative integer index`);
    }
    if (options.cancelsUpperBound !== undefined && value.cancels >= options.cancelsUpperBound) {
      throw new Error(`${path}.cancels must reference an earlier entry (< ${options.cancelsUpperBound})`);
    }
  }
  switch (op) {
    case "merge-concepts":
      assertConceptKey(value.keep, `${path}.keep`);
      if (!Array.isArray(value.merged) || value.merged.length === 0) {
        throw new Error(`${path}.merged must be a non-empty array`);
      }
      value.merged.forEach((key, index) => assertConceptKey(key, `${path}.merged[${index}]`));
      break;
    case "rename-concept":
      assertConceptKey(value.target, `${path}.target`);
      str(value.newName, path, "newName");
      break;
    case "confirm-relation":
      assertRelationKey(value.target, `${path}.target`);
      break;
    case "retype-relation":
      assertRelationKey(value.target, `${path}.target`);
      if (typeof value.verb !== "string" || !(value.verb in RELATION_VERB_PROJECTIONS)) {
        throw new Error(`${path}.verb must be one of ${Object.keys(RELATION_VERB_PROJECTIONS).join(", ")}`);
      }
      assertArchivedRelation(value.archivedRelation, `${path}.archivedRelation`);
      break;
    case "delete-relation":
      assertRelationKey(value.target, `${path}.target`);
      assertArchivedRelation(value.archivedRelation, `${path}.archivedRelation`);
      break;
    case "mark-viewpoint":
      assertConceptKey(value.target, `${path}.target`);
      optStr(value.note, path, "note");
      break;
    // split-concepts / restore-relation 的全部字段已在上面查完。
    case "split-concepts":
    case "restore-relation":
      break;
  }
}

export function assertEditOverlay(value: unknown, path = "overlay"): asserts value is EditOverlay {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  if (value.overlayVersion !== "1.0") {
    throw new Error(`${path}.overlayVersion must be "1.0"`);
  }
  str(value.corpusKey, path, "corpusKey");
  if (!Array.isArray(value.entries)) {
    throw new Error(`${path}.entries must be an array`);
  }
  value.entries.forEach((entry, index) => {
    assertEntryShape(entry, `${path}.entries[${index}]`, {
      requireAt: true,
      cancelsUpperBound: index,
    });
  });
}

/**
 * 校验单条追加请求。服务端不接受客户端给的 at —— 时间戳一律由 appendEntry 盖章，
 * 否则「修改即记录」的时间线可以被随意伪造。请求里 at 允许缺失；若携带则只做类型检查，
 * appendEntry 会覆盖它。cancels 的上界由路由按当前 merged 长度二次收紧。
 */
export function assertOverlayEntryRequest(value: unknown, path = "entry"): void {
  assertEntryShape(value, path, { requireAt: false });
}
