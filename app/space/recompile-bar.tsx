"use client";

import { Fragment } from "react";
import { RECOMPILE_STEPS, type RecompilePhase } from "./recompile-demo-data";
import s from "./space.module.css";

/**
 * 第三幕的「二次编译状态条」（批次 4/5）。
 *
 * 纯展示：idle / running / done 三个形态全部由父组件传进来的状态决定，
 * 组件内部不起状态机、不碰计时器（状态机在 recompile-demo-data.ts）。
 */

interface Props {
  phase: RecompilePhase;
  /** 当前第几步（0..3），跑完后停在最后一步。 */
  stepIndex: number;
  /** 0..100。 */
  pct: number;
  /** 本次新增的规模；running 时递增，done 时是最终值。 */
  counts: { articles: number; concepts: number; relations: number };
  /** 本次新增概念的名字，用于 done 态列标题。 */
  newConceptNames: string[];
  /** 产物覆盖的时间范围，形如 "2024.03→2024.09"。 */
  rangeLabel: string;
  /** done 态是否正聚焦新增（按钮的语义态）。 */
  viewing: boolean;
  onStart: () => void;
  onViewNew: () => void;
}

export function RecompileBar({
  phase,
  stepIndex,
  pct,
  counts,
  newConceptNames,
  rangeLabel,
  viewing,
  onStart,
  onViewNew,
}: Props) {
  return (
    <section
      aria-busy={phase === "running"}
      aria-label="二次编译"
      className={s.recompileBar}
    >
      {phase === "idle" && (
        <div className={s.rcIdle}>
          <span aria-hidden className={s.rcDot} />
          <span className={s.rcIdleText}>
            上次编译覆盖 <b>{rangeLabel}</b> · 检测到新文章，可做一次增量重编译
          </span>
          <button className={s.rcBtn} onClick={onStart} type="button">
            二次编译
          </button>
        </div>
      )}

      {phase === "running" && (
        <div className={s.rcRunning}>
          <div className={s.rcStages}>
            {RECOMPILE_STEPS.map((step, index) => {
              const current = index === stepIndex;
              const finished = index < stepIndex;
              const stageClass = [s.rcStage, current ? s.on : "", finished ? s.done : ""]
                .filter(Boolean)
                .join(" ");
              return (
                <Fragment key={step.label}>
                  {index > 0 && (
                    <span
                      aria-hidden
                      className={[s.rcStageLink, index <= stepIndex ? s.done : ""]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  )}
                  <span className={stageClass}>
                    <i className={s.rcStageNum}>{index + 1}</i>
                    {step.label}
                  </span>
                </Fragment>
              );
            })}
            <span className={s.rcCounts}>
              新增 {counts.articles} 篇 · {counts.concepts} 个概念 · {counts.relations} 条关系
            </span>
          </div>
          <div
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={pct}
            className={s.rcProgress}
            role="progressbar"
          >
            <i className={s.rcProgressBar} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className={s.rcDone}>
          <span className={s.rcDoneOk}>✓ 二次编译完成</span>
          <span className={s.rcDoneSum}>
            新增 <b>{counts.articles}</b> 篇文章 · 新增 <b>{counts.concepts}</b> 个概念 ·{" "}
            <b>{counts.relations}</b> 条新关系
          </span>
          <button
            aria-pressed={viewing}
            className={[s.rcGhost, viewing ? s.primary : ""].filter(Boolean).join(" ")}
            onClick={onViewNew}
            type="button"
          >
            查看新增
          </button>
          <p className={s.rcDoneTitles}>
            {newConceptNames.length ? (
              <>
                新增概念：
                {newConceptNames.map((name, index) => (
                  <span key={name}>
                    {index > 0 ? "、" : ""}
                    <b>{name}</b>
                  </span>
                ))}
                <span> · </span>
              </>
            ) : null}
            覆盖 <b>{rangeLabel}</b>
          </p>
        </div>
      )}
    </section>
  );
}
