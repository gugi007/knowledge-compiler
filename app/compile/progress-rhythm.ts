"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCT_STAGES, type ProductStage } from "@/lib/frontend/compile-stream";
import type { CompileStatus } from "@/app/_shared/hooks/use-compile";
import { COMPILE_STEP_LABELS } from "./stage-presenters";

/**
 * 编译台的展示进度节奏：产品四阶段的纯客户端状态机。
 *
 * OWNER: compiler-ui-agent
 *
 * 设计决策：
 * - **不消费 `compile.progress`**。服务端 `emitStage`（lib/compiler/compile.ts）
 *   每个内部阶段只发一次 stage 事件，客户端实际收到的是
 *   0.03 → 0.05 → 0.80 → 0.90 → 0.98 → 1 六次硬跳，与产品叙事的
 *   0 / 25 / 75 / 90 / 98 是两套语义。展示进度按产品阶段区间自己重算，
 *   百分比 / Stepper / 状态文案 / 完成态全部由这里的同一份状态派生，
 *   杜绝「阶段已标记完成但百分比没跟上」。
 * - **阶段内**用帧率无关的指数追踪逼近本段上限（惯用法同
 *   app/login/knowledge-graph-background.tsx 的 `1 - Math.exp(-dt / tau)`），
 *   只逼近不过冲。**换段时不再瞬间吸附**：显示值若落后于新段起点
 *   （差距 > `SWEEP_EPSILON`），用 `SWEEP_SECONDS` 的 easeOutCubic 扫补滑过去，
 *   差距本来就很小的常规路径仍直接进追踪。两种写法都是为了「进入关系阶段
 *   必须同步到 75%」，但扫补是渐进的，视觉上不再闪现。
 *   同步性由**同源派生**保证：Stepper 的 active 项与状态行文案都从 pct 走
 *   `stageAtPct`，扫补期间两者一起走、一起跨过 75，不会出现「阶段已激活、
 *   条还停在 53%」的分叉。**因此不得改成直接读服务端 productStage。**
 * - **reading 段有最短停留保底**（`MIN_BAND_SECONDS`）：解析阶段真实耗时可能
 *   不到 1s，若立刻换段，0→25 会在个位数上被扫补推走，看着像「0 直接变 26」。
 *   待够保底时长才允许换段，让开头那一下爬升有肉眼可反应的时长。
 * - **收尾三段**（补间 → 100% 停留 → 切结果页）与阶段追踪共用**一条 rAF、
 *   一个 cleanup 出口**，不用 setTimeout：两套时钟两处清理，StrictMode 双跑更易漏。
 *   时钟是**虚拟时间**（累加 dt），页签隐藏时 rAF 本就不跑，回到前台补间/停留
 *   从原处续走，而不是瞬间跳完。
 * - **prefers-reduced-motion**（仓库既定双轨惯例，CSS 兜底在 app/globals.css）：
 *   命中时不做插值，数字只在 band 边界跳（0/25/75/90/100）；1.5s 停留保留，
 *   它不是动效。
 * - 纯函数（advanceRhythm / stageAtPct / easeOutCubic）与 rAF 驱动分离，
 *   仓库无测试框架，拆出来便于将来直接接测试。
 *
 * 配套约束：`compile.module.css` 的 `.progressFill` **不得**再加
 * `transition: width`。宽度是这里每帧直接写的；换段的扫补已经是 JS 里显式
 * 实现的缓动，CSS 的 `transition: width` 会在其上**再叠一层自己的缓动**，
 * 两段缓动串联会让条明显滞后于数字，正是要杜绝的不同步。
 */

/* =========================
   可调参数（视觉验收后只动这里）
========================== */

/**
 * 产品四阶段的显示区间（百分比 0..100）。
 *
 * | 阶段 | 语义 |
 * |---|---|
 * | reading | 0% → 25%（有 MIN_BAND_SECONDS 保底停留） |
 * | concepts | 进了就扫到 25%，阶段内推进到 75% |
 * | relations | **进了就扫到 75%**（约 SWEEP_SECONDS），阶段内推进到约 90% |
 * | graph | 90% → 98% |
 */
export const PRODUCT_STAGE_BANDS: Record<ProductStage, { from: number; to: number }> = {
  reading: { from: 0, to: 25 },
  concepts: { from: 25, to: 75 },
  relations: { from: 75, to: 90 },
  graph: { from: 90, to: 98 },
};

/**
 * 各段指数追踪的时间常数（秒）——越小爬得越快。
 * concepts 段覆盖两个内部阶段（extracting-concepts + resolving-concepts，
 * 中间不产生边界），LLM provider 下可能持续 30–60s，取 12s 让它一路爬升
 * 而不是早早冻在 75%；窄段取更小值，免得整段只挪几个百分点。
 */
const BAND_TAU: Record<ProductStage, number> = {
  reading: 2.5,
  concepts: 12,
  relations: 4,
  graph: 2,
};

/** 换段扫补时长（秒）：显示值落后于新段起点时，用 easeOutCubic 滑过去，而不是瞬间跳。 */
const SWEEP_SECONDS = 0.45;
/** 扫补触发阈值（百分点）：差距小于它就没必要走扫补，直接进追踪。 */
const SWEEP_EPSILON = 0.5;
/** 各段最短停留（秒）：服务端已推进但本段还没待够时，按住不换段。 */
const MIN_BAND_SECONDS: Record<ProductStage, number> = {
  reading: 1.5, // 解析阶段真实耗时可能不到 1s，保底让 0→25 走得看得见
  concepts: 0,
  relations: 0,
  graph: 0,
};
/** 「无扫补」哨兵：sweepFrom 语义上只可能是 ≥ 0 的百分点，负数不会撞上。 */
const NO_SWEEP = -1;

/** 完成补间时长（秒）：从当前显示值 easeOutCubic 到 100。 */
const FINISH_TWEEN_SECONDS = 1;
/** 补间走完后的 100% 停留时长（秒）：从补间结束起算。 */
const FINISH_HOLD_SECONDS = 1.5;
/** 单帧 dt 上限（秒）：切回前台的第一帧不产生巨大步长（否则会瞬间跳完）。 */
const MAX_FRAME_DT = 0.1;
/** 终值（百分比口径，非 [0,1]；compile.progress 的 [0,1] 在这里不适用）。 */
const FULL_PCT = 100;
/** 收尾期间的状态行文案（规格逐字给定）。 */
const FINISHING_TEXT = "编译完成，正在整理结果…";

/* =========================
   纯函数（无 React、无 DOM）
========================== */

/** 收尾三段：阶段内追踪 / 补间到 100 / 100% 停留。 */
export type RhythmPhase = "track" | "tween" | "hold";

/** 一帧的全部状态。驱动层只负责把它交给 advanceRhythm 并写回。 */
export interface RhythmFrame {
  /** 显示百分比（0..100，**未取整**；宽度用原值，文案用取整值）。 */
  pct: number;
  /** 正在追踪的产品阶段（band 变化的判定依据）。 */
  stage: ProductStage;
  phase: RhythmPhase;
  /** 补间起点（phase === "tween" 时有效）。 */
  tweenFrom: number;
  /** 收尾虚拟时间（秒）：tween 与 hold 共用。 */
  vt: number;
  /** 停留结束 → 可以切结果页。 */
  finished: boolean;
  /** 在当前段已停留的虚拟时间（秒）：MIN_BAND_SECONDS 闸门的计时器。 */
  bandVt: number;
  /** 扫补起点（百分点）；无扫补时无意义（NO_SWEEP）。 */
  sweepFrom: number;
  /** 扫补已走虚拟时间（秒）。 */
  sweepVt: number;
}

export interface RhythmInput {
  status: CompileStatus;
  productStage?: ProductStage;
  /** 本帧时长（秒，调用方已做上限截断）。 */
  dt: number;
  reducedMotion: boolean;
}

/** 初始帧：0%、追踪 reading 段。 */
export const IDLE_FRAME: RhythmFrame = {
  pct: 0,
  stage: "reading",
  phase: "track",
  tweenFrom: 0,
  vt: 0,
  finished: false,
  bandVt: 0,
  sweepFrom: NO_SWEEP,
  sweepVt: 0,
};

/** easeOutCubic：末段减速，收尾补间用。k 越界时按 0/1 夹取。 */
export function easeOutCubic(k: number): number {
  const clamped = k < 0 ? 0 : k > 1 ? 1 : k;
  return 1 - (1 - clamped) ** 3;
}

/**
 * 显示百分比落在哪个产品阶段（band 的 from 已达 → 就是该段）。
 * Stepper 的 active 项由它派生，与百分比同源，不会各算各的。
 */
export function stageAtPct(pct: number): ProductStage {
  for (let i = PRODUCT_STAGES.length - 1; i > 0; i--) {
    const stage = PRODUCT_STAGES[i]!;
    if (pct >= PRODUCT_STAGE_BANDS[stage].from) return stage;
  }
  return PRODUCT_STAGES[0]!;
}

/**
 * 单帧推进（纯函数，唯一的阶段/收尾状态机）。
 *
 * - running：指数追踪本段上限；换段时若显示值落后于新段起点就扫补过去
 *   （单调不回退），差距小则直接接着追踪；reading 段有最短停留保底。
 * - error：原样冻结（显示值与 Stepper 一起停在中断处）。
 * - done：track 帧升级成 tween 帧（从**当前值**起，不先吸附到 98/100）→
 *   补间到 100 → 停留 FINISH_HOLD_SECONDS → finished 置真。
 * - idle：回到初始帧（正常路径由 reset() 归零，这里是防御）。
 */
export function advanceRhythm(frame: RhythmFrame, input: RhythmInput): RhythmFrame {
  const { status, productStage, dt, reducedMotion } = input;

  if (status === "idle") return IDLE_FRAME;
  if (status === "error") return frame;

  if (status === "done") {
    if (frame.phase === "track") {
      // 完成瞬间：从当前显示值起补间。reduced-motion 不插值，直接站上 100。
      return reducedMotion
        ? { ...frame, pct: FULL_PCT, phase: "hold", vt: 0, finished: false }
        : { ...frame, phase: "tween", tweenFrom: frame.pct, vt: 0, finished: false };
    }
    if (frame.phase === "tween") {
      const vt = frame.vt + dt;
      const k = Math.min(1, vt / FINISH_TWEEN_SECONDS);
      if (k >= 1) return { ...frame, pct: FULL_PCT, phase: "hold", vt: 0, finished: false };
      const pct = frame.tweenFrom + (FULL_PCT - frame.tweenFrom) * easeOutCubic(k);
      return { ...frame, pct, vt };
    }
    // hold：100% 停留（reduced-motion 下同样保留——它不是动效）。
    const vt = frame.vt + dt;
    return { ...frame, pct: FULL_PCT, vt, finished: vt >= FINISH_HOLD_SECONDS };
  }

  // running
  // 1) 最短停留闸：服务端已推进但本段还没待够（只有 reading 非零）就按住不换段。
  //    bandVt 是被闸住也继续累加的，所以到点自然放行。
  const incoming = productStage ?? frame.stage;
  const bandVt = frame.bandVt + dt; // 含本帧
  const blocked =
    incoming !== frame.stage && bandVt < MIN_BAND_SECONDS[frame.stage];
  const stage = blocked ? frame.stage : incoming; // 被闸住时本帧仍留在原段
  const stageChanged = stage !== frame.stage;
  const nextBandVt = stageChanged ? 0 : bandVt; // 真换了段才归零

  // 2) 换段且显示值明显落后 → 走扫补。四段首尾相接（前段 to = 后段 from），
  //    指数追踪是渐近的所以总会差一点点，SWEEP_EPSILON 把这种常规收尾挡在外面；
  //    显示值已经高于新段起点（乱序事件）时也不触发，只继续从当前值追踪。
  const band = PRODUCT_STAGE_BANDS[stage];
  // 同一段内从当前值继续追踪；上一轮的收尾帧（phase !== track）不算数，从 0 起算。
  const tracked = frame.phase === "track" ? frame.pct : 0;
  const needsSweep =
    stageChanged && !reducedMotion && band.from - tracked > SWEEP_EPSILON;

  // 3) 算显示值。扫补与指数追踪互斥，不叠加。
  let pct: number;
  let sweepFrom = frame.sweepFrom;
  let sweepVt = frame.sweepVt;

  if (reducedMotion) {
    // 降级：不做插值，数字只在 band 边界跳；扫补一并跳过。
    pct = Math.max(tracked, band.from);
    sweepFrom = NO_SWEEP;
    sweepVt = 0;
  } else if (needsSweep) {
    // 本帧刚触发：起点取当前显示值，本帧就算进扫补时间。
    sweepFrom = tracked;
    sweepVt = dt;
    const k = Math.min(1, sweepVt / SWEEP_SECONDS);
    if (k >= 1) {
      // 极端情况下（单帧 dt 就超过扫补时长）直接落到新段起点。
      pct = band.from;
      sweepFrom = NO_SWEEP;
      sweepVt = 0;
    } else {
      pct = sweepFrom + (band.from - sweepFrom) * easeOutCubic(k);
    }
  } else if (sweepFrom !== NO_SWEEP) {
    // 扫补进行中：只走扫补曲线。
    sweepVt += dt;
    const k = Math.min(1, sweepVt / SWEEP_SECONDS);
    if (k >= 1) {
      pct = band.from;
      sweepFrom = NO_SWEEP;
      sweepVt = 0;
    } else {
      pct = sweepFrom + (band.from - sweepFrom) * easeOutCubic(k);
    }
  } else {
    // 正常追踪：只逼近不过冲（不回退由末尾的单调性总闸保证）。
    pct = tracked + (band.to - tracked) * (1 - Math.exp(-dt / BAND_TAU[stage]));
  }

  // 4) 单调性总闸：任何分支都不得把显示值往回拽（乱序事件防御）。
  //    正常路径恒为 no-op（reducedMotion / 刚触发扫补 / 正常追踪三个分支的下界
  //    本来就是 tracked）；只覆盖「扫补途中被乱序事件换掉了 band.from，于是落到
  //    「扫补进行中」分支、却按新段的 band.from 往回扫」这条病态路径。
  //    被钉住时扫补走完 k >= 1 会清掉 sweepFrom，下一帧从高水位继续追踪，不会卡死。
  if (pct < tracked) pct = tracked;

  // 5) 写回。扫补结束后从 band.from 自然接上追踪（下一帧 tracked = band.from，
  //    目标 band.to），不会有停顿或回退。
  return { ...frame, pct, stage, phase: "track", bandVt: nextBandVt, sweepFrom, sweepVt };
}

/* =========================
   hook：唯一展示状态来源
========================== */

export interface UseCompileRhythmOptions {
  status: CompileStatus;
  productStage?: ProductStage;
}

/** 编译台展示状态的唯一来源：CompileProgress / Stepper / 完成态都从这里取。 */
export interface CompileRhythm {
  /** 显示百分比（0..100，未取整）。进度条宽度用原值，文案用 Math.round。 */
  pct: number;
  /** 状态行文案：待开始 / 正在X / 编译中断 / 编译完成，正在整理结果… */
  statusText: string;
  /** 当前产品阶段（Stepper 的 active 项），由 pct 派生。 */
  stepperStage: ProductStage;
  /** 四步是否全部完成（= 已站上 100%）。 */
  allDone: boolean;
  /** 尚未开始。 */
  idle: boolean;
  /** 编译中断（显示值冻结在中断处）。 */
  error: boolean;
  /** 已收到 complete，正在补间 / 停留：视图仍是编译中，数字走向终态。 */
  finishing: boolean;
  /** 补间 + 停留都结束 → 可以切结果页。 */
  done: boolean;
  /** 归零（开始编译、重试、再编译一次都要调）。 */
  reset: () => void;
}

export function useCompileRhythm({
  status,
  productStage,
}: UseCompileRhythmOptions): CompileRhythm {
  const [pct, setPct] = useState(0);
  const [done, setDone] = useState(false);
  const frameRef = useRef<RhythmFrame>(IDLE_FRAME);

  const reset = useCallback(() => {
    frameRef.current = IDLE_FRAME;
    setPct(0);
    setDone(false);
  }, []);

  // 唯一一条 rAF：追踪、补间、停留共用；一个 cleanup 出口。
  // idle / error 无动画（error 冻结上一帧的显示值），直接不启动。
  // status 或 productStage 变化 → 旧循环由 cleanup 取消，新循环接着跑。
  useEffect(() => {
    if (status !== "running" && status !== "done") return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_FRAME_DT);
      last = now;
      const previous = frameRef.current;
      const next = advanceRhythm(previous, {
        status,
        productStage,
        dt,
        reducedMotion: motion.matches,
      });
      frameRef.current = next;
      // 只在真正变化时 setState：停留期间 pct 恒为 100，不必每帧重渲。
      if (next.pct !== previous.pct) setPct(next.pct);
      if (next.finished) {
        setDone(true);
        return; // 不再排下一帧：循环自然结束
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [status, productStage]);

  const idle = status === "idle";
  const error = status === "error";
  const finishing = status === "done";
  // idle 一律按 0 对外：三条离开 idle 的路径（开始编译 / 重试 / 再编译一次）都会
  // 先 reset()，这里再夹一道，保证「未开始时不可能显示非 0」，不会闪一帧上一轮的终值。
  const displayPct = idle ? 0 : pct;
  const allDone = displayPct >= FULL_PCT;
  const stepperStage = stageAtPct(displayPct);
  const statusText = idle
    ? "待开始"
    : error
      ? "编译中断"
      : finishing
        ? FINISHING_TEXT
        : `正在${COMPILE_STEP_LABELS[stepperStage]}`;

  return {
    pct: displayPct,
    statusText,
    stepperStage,
    allDone,
    idle,
    error,
    finishing,
    done,
    reset,
  };
}
