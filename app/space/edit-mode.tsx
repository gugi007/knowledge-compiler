"use client";

import { useEffect, useRef, useState } from "react";
import type { Concept } from "@/data/models";
import s from "./space.module.css";

/**
 * 编辑模式：本地校对动作条。（批次 5/5 仅视觉重绘）
 *
 * OWNER: knowledge-space-agent
 *
 * 重要边界：当前分支没有作者修改的持久层（overlay，见架构文档 C4），
 * 所有改动只存在于本组件的内存态，刷新即丢失。这里做完整交互，
 * 等 overlay 契约落地后由 integration 接到持久层，不需要重写 UI。
 *
 * 支持动作：
 * - 重命名：改当前概念的显示名（本地覆盖）
 * - 确认：标记「已校对」
 * - 修正：改写摘要（本地覆盖）
 * - 删除：从视图隐藏（本地）
 * - 合并：把另一个概念并进当前概念（本地，画布与列表即时反映）
 *
 * 批次 5/5 的改动只在样式层：改用 space.module.css 的
 * editBar / editCard / editField / editInput / editTextarea / editSelect
 * 等既有类名重排结构；状态管理（EditMap / ConceptEdit / absorbedInto /
 * onApply / onMerged）与对外导出一律未变，仍然不接后端、不落盘。
 */

export interface ConceptEdit {
  renamedTo?: string;
  summaryOverride?: string;
  confirmed?: boolean;
  deleted?: boolean;
  /** 被合并进来的概念 id 们（它们应当隐藏，关系与证据并到当前概念）。 */
  absorbedIds?: string[];
}

export type EditMap = Map<string, ConceptEdit>;

/** 被合并走的概念 → 合并目标。 */
export function absorbedInto(edits: EditMap): Map<string, string> {
  const map = new Map<string, string>();
  for (const [targetId, edit] of edits) {
    for (const sourceId of edit.absorbedIds ?? []) {
      map.set(sourceId, targetId);
    }
  }
  return map;
}

interface Props {
  concept: Concept;
  allConcepts: readonly Concept[];
  edit: ConceptEdit | undefined;
  onApply: (id: string, edit: ConceptEdit) => void;
  /** 合并完成后跳转到目标概念。 */
  onMerged: (fromId: string, intoId: string) => void;
}

export function EditBar({ concept, allConcepts, edit, onApply, onMerged }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [merging, setMerging] = useState(false);
  /** 合并下拉框的当前选择（纯 UI 态，不参与 EditMap）。 */
  const [mergeTarget, setMergeTarget] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (renaming) nameRef.current?.focus();
  }, [renaming]);
  useEffect(() => {
    if (correcting) summaryRef.current?.focus();
  }, [correcting]);

  const mergeCandidates = allConcepts.filter(
    (candidate) => candidate.id !== concept.id && !(edit?.absorbedIds ?? []).includes(candidate.id),
  );

  const touched = Boolean(
    edit && (edit.renamedTo || edit.summaryOverride || edit.deleted || edit.absorbedIds?.length),
  );

  /** 三个互斥面板的开关，保持原有「开一个关其余」的行为。 */
  const togglePanel = (panel: "rename" | "correct" | "merge") => {
    setRenaming(panel === "rename" ? (value) => !value : false);
    setCorrecting(panel === "correct" ? (value) => !value : false);
    setMerging(panel === "merge" ? (value) => !value : false);
    if (panel === "merge") setMergeTarget("");
  };

  const commitMerge = () => {
    if (!mergeTarget) return;
    onApply(concept.id, {
      ...edit,
      absorbedIds: [...(edit?.absorbedIds ?? []), mergeTarget],
    });
    setMerging(false);
    setMergeTarget("");
    onMerged(mergeTarget, concept.id);
  };

  return (
    <div>
      {/* ------------------------------------------------------ 动作条 */}
      <div className={s.editBar}>
        <span className={s.editBarLabel}>编辑</span>
        {edit?.confirmed ? (
          <span className={s.editSaved}>✓ 已确认</span>
        ) : touched ? (
          <span className={s.editDirty}>未持久化改动</span>
        ) : (
          <span className={s.editBarHint}>本地校对态 · 未持久化</span>
        )}
        <div className={s.editActions}>
          <button className={s.editGhost} onClick={() => togglePanel("rename")} type="button">
            重命名
          </button>
          <button className={s.editGhost} onClick={() => togglePanel("correct")} type="button">
            修正摘要
          </button>
          <button className={s.editGhost} onClick={() => togglePanel("merge")} type="button">
            合并…
          </button>
          <button
            className={s.editGhost}
            onClick={() => onApply(concept.id, { ...edit, confirmed: !edit?.confirmed })}
            type="button"
          >
            {edit?.confirmed ? "撤销确认" : "确认"}
          </button>
          <button
            className={s.editGhost}
            onClick={() => onApply(concept.id, { ...edit, deleted: true })}
            style={{ color: "#d6457f", borderColor: "rgba(214, 69, 127, 0.45)" }}
            type="button"
          >
            删除
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------ 重命名 */}
      {renaming && (
        <form
          className={s.editCard}
          onSubmit={(event) => {
            event.preventDefault();
            const value = nameRef.current?.value.trim();
            if (value && value !== concept.name) {
              onApply(concept.id, { ...edit, renamedTo: value });
            }
            setRenaming(false);
          }}
          style={{ marginTop: 10 }}
        >
          <div className={s.editField}>
            <label className={s.editFieldLabel} htmlFor={`rename-${concept.id}`}>
              概念名称
            </label>
            <input
              className={s.editInput}
              defaultValue={edit?.renamedTo ?? concept.name}
              id={`rename-${concept.id}`}
              ref={nameRef}
            />
          </div>
          <div
            className={s.editActions}
            style={{ justifyContent: "flex-end", marginTop: 14 }}
          >
            <button
              className={s.editGhost}
              onClick={() => setRenaming(false)}
              type="button"
            >
              取消
            </button>
            <button className={s.editPrimary} type="submit">
              保存
            </button>
          </div>
        </form>
      )}

      {/* ---------------------------------------------------- 修正摘要 */}
      {correcting && (
        <form
          className={s.editCard}
          onSubmit={(event) => {
            event.preventDefault();
            const value = summaryRef.current?.value.trim();
            if (value) onApply(concept.id, { ...edit, summaryOverride: value });
            setCorrecting(false);
          }}
          style={{ marginTop: 10 }}
        >
          <div className={s.editField}>
            <label className={s.editFieldLabel} htmlFor={`summary-${concept.id}`}>
              概念摘要
            </label>
            <textarea
              className={s.editTextarea}
              defaultValue={edit?.summaryOverride ?? concept.summary}
              id={`summary-${concept.id}`}
              ref={summaryRef}
            />
          </div>
          <div
            className={s.editActions}
            style={{ justifyContent: "flex-end", marginTop: 14 }}
          >
            <button
              className={s.editGhost}
              onClick={() => setCorrecting(false)}
              type="button"
            >
              取消
            </button>
            <button className={s.editPrimary} type="submit">
              保存修正
            </button>
          </div>
        </form>
      )}

      {/* -------------------------------------------------------- 合并 */}
      {merging && (
        <form
          className={s.editCard}
          onSubmit={(event) => {
            event.preventDefault();
            commitMerge();
          }}
          style={{ marginTop: 10 }}
        >
          <div className={s.editField}>
            <label className={s.editFieldLabel} htmlFor={`merge-${concept.id}`}>
              并入「{concept.name}」
            </label>
            <select
              className={s.editSelect}
              id={`merge-${concept.id}`}
              onChange={(event) => setMergeTarget(event.target.value)}
              value={mergeTarget}
            >
              <option value="">
                {mergeCandidates.length ? "选择要合并的概念…" : "没有可合并的概念"}
              </option>
              {mergeCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.domain}
                </option>
              ))}
            </select>
          </div>
          <div
            className={s.editActions}
            style={{ justifyContent: "flex-end", marginTop: 14 }}
          >
            <button
              className={s.editGhost}
              onClick={() => {
                setMerging(false);
                setMergeTarget("");
              }}
              type="button"
            >
              取消
            </button>
            <button className={s.editPrimary} disabled={!mergeTarget} type="submit">
              合并
            </button>
          </div>
        </form>
      )}

      <p className={`${s.editBarHint} ${s.editHintGap}`}>
        本地校对态 · 未持久化（等待 overlay 契约，见架构文档 C4）
      </p>
    </div>
  );
}
