"use client";

import { useEffect, useRef, useState } from "react";
import type { Concept } from "@/data/models";

/**
 * 编辑模式：本地校对动作条。
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

  return (
    <div className="rounded-xl border border-dashed border-coral/40 bg-lime/50 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-black tracking-widest text-coral/70 uppercase">
          编辑
        </span>
        <button
          className="concept-pill !px-2.5 !py-1 text-[11px]"
          onClick={() => {
            setRenaming((v) => !v);
            setCorrecting(false);
            setMerging(false);
          }}
          type="button"
        >
          重命名
        </button>
        <button
          className="concept-pill !px-2.5 !py-1 text-[11px]"
          onClick={() => {
            setCorrecting((v) => !v);
            setRenaming(false);
            setMerging(false);
          }}
          type="button"
        >
          修正摘要
        </button>
        <button
          className="concept-pill !px-2.5 !py-1 text-[11px]"
          onClick={() => {
            setMerging((v) => !v);
            setRenaming(false);
            setCorrecting(false);
          }}
          type="button"
        >
          合并…
        </button>
        <button
          className={`concept-pill !px-2.5 !py-1 text-[11px] ${
            edit?.confirmed ? "border-[#12a182] text-[#12a182]" : ""
          }`}
          onClick={() => onApply(concept.id, { ...edit, confirmed: !edit?.confirmed })}
          type="button"
        >
          {edit?.confirmed ? "✓ 已确认" : "确认"}
        </button>
        <button
          className="concept-pill !px-2.5 !py-1 text-[11px] hover:!border-[#d6457f] hover:!text-[#d6457f]"
          onClick={() => onApply(concept.id, { ...edit, deleted: true })}
          type="button"
        >
          删除
        </button>
      </div>

      {renaming && (
        <form
          className="mt-2.5 flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const value = nameRef.current?.value.trim();
            if (value && value !== concept.name) {
              onApply(concept.id, { ...edit, renamedTo: value });
            }
            setRenaming(false);
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-xs"
            defaultValue={edit?.renamedTo ?? concept.name}
            ref={nameRef}
          />
          <button
            className="rounded-lg bg-coral px-3 py-1.5 text-xs font-bold text-white"
            type="submit"
          >
            保存
          </button>
        </form>
      )}

      {correcting && (
        <form
          className="mt-2.5 grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const value = summaryRef.current?.value.trim();
            if (value) onApply(concept.id, { ...edit, summaryOverride: value });
            setCorrecting(false);
          }}
        >
          <textarea
            className="min-h-20 rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-xs leading-5"
            defaultValue={edit?.summaryOverride ?? concept.summary}
            ref={summaryRef}
          />
          <button
            className="justify-self-end rounded-lg bg-coral px-3 py-1.5 text-xs font-bold text-white"
            type="submit"
          >
            保存修正
          </button>
        </form>
      )}

      {merging && (
        <div className="mt-2.5">
          <p className="text-[11px] text-ink/55">选择要并入「{concept.name}」的概念：</p>
          <div className="scrollbar mt-1.5 grid max-h-36 gap-1 overflow-y-auto">
            {mergeCandidates.map((candidate) => (
              <button
                className="relation-row !p-2 text-xs"
                key={candidate.id}
                onClick={() => {
                  onApply(concept.id, {
                    ...edit,
                    absorbedIds: [...(edit?.absorbedIds ?? []), candidate.id],
                  });
                  setMerging(false);
                  onMerged(candidate.id, concept.id);
                }}
                type="button"
              >
                <span className="truncate">{candidate.name}</span>
                <span className="font-mono text-[9px] text-ink/35">{candidate.domain}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2 font-mono text-[9px] leading-4 text-ink/35">
        本地校对态 · 未持久化（等待 overlay 契约，见架构文档 C4）
      </p>
    </div>
  );
}
