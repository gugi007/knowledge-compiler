"use client";

import type { ProductStage } from "@/lib/frontend/compile-stream";
import { PRODUCT_STAGES } from "@/lib/frontend/compile-stream";
import type { CompileState } from "@/app/_shared/hooks/use-compile";
import { COMPILE_STEP_LABELS } from "./stage-presenters";
import type { CompileRhythm } from "./progress-rhythm";
import styles from "./compile.module.css";

/**
 * 编译中视图的左栏进度与右栏实时状态（参考稿 compiler.html 两栏面板移植）。
 *
 * OWNER: compiler-ui-agent
 *
 * - 左栏：状态行（百分比 + 当前阶段文案 + hover tooltip）→ 3px 进度条 →
 *   竖向 4 步 stepper。**三段都只从 `rhythm`（progress-rhythm.ts 的唯一状态源）
 *   取值**，不再各自读 compile.progress：百分比与 Stepper 完成态同源派生，
 *   不会出现「阶段完成了但百分比没跟上」。
 *   无障碍：aria-valuenow 用 5% 量化（每帧变会让屏幕阅读器刷屏），
 *   aria-valuetext 给完整语义。
 * - 右栏：3 行实时统计（全部来自事件 counts，诚实降级——管线没有
 *   「已锚定原文」字段，不做这一行）+「最近活动」合成日志（由
 *   compile-workspace 按收到的 stage / complete 事件合成，不伪造逐篇日志）。
 *
 * MiniStarMap 迷你星图已按重造方案移除（参考稿无此位置）。
 */

/** 「最近活动」一条合成日志：本地 HH:MM 时间戳 + 阶段文案。 */
export interface ActivityEntry {
  time: string;
  text: string;
}

/**
 * 阶段状态推导：当前阶段之前的算完成，之后的待进行。
 * `stepperStage` / `allDone` / `idle` 全部来自 rhythm（与百分比同源），
 * 这里不再自己读 compile.status——否则停留期间会出现「条到 100 了但步骤还没打勾」。
 */
function stepState(
  stage: ProductStage,
  stepperStage: ProductStage,
  allDone: boolean,
  idle: boolean,
): "done" | "active" | "pending" {
  if (idle) return "pending";
  if (allDone) return "done";
  const index = PRODUCT_STAGES.indexOf(stage);
  const active = PRODUCT_STAGES.indexOf(stepperStage);
  if (index < active) return "done";
  if (index === active) return "active";
  return "pending";
}

function StepDot({ state, index }: { state: "done" | "active" | "pending"; index: number }) {
  return (
    <span className={styles.stepDot}>
      {state === "done" ? (
        <svg
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          viewBox="0 0 24 24"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        index + 1
      )}
    </span>
  );
}

/** 左栏：状态行 + 进度条 + 竖向 stepper。三段全部由 rhythm 一个对象驱动。 */
export function CompileProgress({ rhythm }: { rhythm: CompileRhythm }) {
  const pct = rhythm.pct;
  const rounded = Math.round(pct);
  // 无障碍：量化到 5% 的整数倍（向下取整，只会低报不会虚报），
  // 避免每帧刷新 aria-valuenow 让屏幕阅读器刷屏。
  const ariaNow = Math.floor(pct / 5) * 5;
  const ariaText = rhythm.idle
    ? "尚未开始"
    : rhythm.error
      ? `编译中断，停在 ${rounded}%`
      : rhythm.allDone
        ? "编译完成"
        : `${rhythm.statusText}，约 ${ariaNow}%`;

  return (
    <>
      <div className={styles.statusLine}>
        <span className={styles.statusPct}>{rounded}%</span>
        <span className={styles.statusWhat}>{rhythm.statusText}</span>
        <span className={styles.statusTooltip} role="tooltip">
          进度按四个产品阶段的节奏推进，不是服务端逐篇计数；切换阶段时会平滑滑到该段起点。
        </span>
      </div>
      <div
        aria-label="编译进度"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={ariaNow}
        aria-valuetext={ariaText}
        className={styles.progress}
        role="progressbar"
      >
        {/* 宽度用未取整值：取整会让每帧的推进在 1% 内被抹平，条看起来是顿的。 */}
        <i className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>

      <div className={styles.stepper}>
        {PRODUCT_STAGES.map((stage, index) => {
          const state = stepState(
            stage,
            rhythm.stepperStage,
            rhythm.allDone,
            rhythm.idle,
          );
          const className =
            state === "done"
              ? `${styles.step} ${styles.stepDone}`
              : state === "active"
                ? `${styles.step} ${styles.stepActive}`
                : styles.step;
          return (
            <div className={className} key={stage}>
              <div className={styles.stepNode}>
                <StepDot index={index} state={state} />
                <span className={styles.stepLine} />
              </div>
              <div className={styles.stepText}>
                <div className={styles.stepName}>{COMPILE_STEP_LABELS[stage]}</div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** 右栏：3 行实时统计 + 最近活动合成日志。 */
export function LiveStats({
  activity,
  compile,
}: {
  activity: ActivityEntry[];
  compile: CompileState;
}) {
  const { counts } = compile;
  const idle = compile.status === "idle";

  return (
    <>
      <div className={styles.colLabel}>
        <span>实时编译状态</span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.statRowK}>已读取文章</span>
        <span className={styles.statRowV}>
          {idle ? (
            "—"
          ) : (
            <>
              {counts.articlesDone}{" "}
              <span className={styles.statRowOf}>/ {counts.articlesTotal}</span>
            </>
          )}
        </span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.statRowK}>已识别概念</span>
        <span className={styles.statRowV}>{idle ? "—" : counts.concepts}</span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.statRowK}>已建立关系</span>
        <span className={styles.statRowV}>{idle ? "—" : counts.conceptRelations}</span>
      </div>

      <div className={`${styles.colLabel} ${styles.logLabel}`}>
        <span>最近活动</span>
      </div>
      <div aria-live="polite" className={styles.log}>
        {activity.length === 0 ? (
          <div className={styles.logLine}>
            <span className={styles.logTime}>--:--</span>
            <span className={styles.logMark} />
            <span>尚未开始</span>
          </div>
        ) : (
          activity.map((entry, index) => (
            <div
              className={
                index === activity.length - 1
                  ? `${styles.logLine} ${styles.logLineNow}`
                  : styles.logLine
              }
              key={`${entry.time}-${index}`}
            >
              <span className={styles.logTime}>{entry.time}</span>
              <span className={styles.logMark} />
              <span>{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
