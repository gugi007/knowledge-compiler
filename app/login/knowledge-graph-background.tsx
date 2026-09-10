"use client";

import { Fragment, useEffect, useRef } from "react";
import styles from "./login.module.css";

/**
 * 第一幕背景：会缓慢呼吸 / 漂移的知识图谱（纯装饰层）。
 *
 * OWNER: login-agent
 *
 * 坐标原样复用 login-screen 旧内联 SVG 的布局（5 个圆节点 + 3 个线端点，
 * 端点补成小节点让每条线都连在节点上），再按同一浅蓝细线风格少量补节点，
 * 桌面共 11 个节点 / 10 条线；标记 ext 的扩展层在 ≤768px 由 CSS 隐藏。
 * 不重新随机布局。
 *
 * 分工：
 * - rAF（本文件）：节点正弦漂移 + 呼吸缩放/透明度 + 连线端点逐帧跟随
 *   + 鼠标轻推（window 监听，pointer:fine 且 >768px 才启用）。
 *   每帧只 setAttribute，不重渲染 React、不重建 DOM。
 * - CSS（login.module.css 新增类）：整体慢漂移（.graphDriftWrap 的
 *   graphDrift keyframes）与 2~3 条连线上的信息流光点（.graphFlow 的
 *   graphFlow keyframes，dasharray 2+418 保证单线同时至多一个光点）。
 *
 * 降级：
 * - prefers-reduced-motion: reduce → CSS 关两条动画 + JS 不起 rAF（渲染静态图）。
 * - ≤768px / 粗指针 → 隐藏扩展节点与光点、关闭鼠标交互，只留核心层缓漂。
 * - document.hidden → 暂停 rAF，恢复时继续（虚拟时间不跳变）。
 *
 * 层叠与交互：svg 沿用 .graph（绝对定位、无 z-index、pointer-events:none、
 * opacity .75），.panel 的 z-index:2 仍在其上；本组件不新增任何可交互元素。
 */

/* =========================
   可调参数（想要更「静」或更「活」只动这里）
========================== */

/** 节点漂移幅度上下限（viewBox 单位 px）。调大 → 摆得更远。 */
const DRIFT_AMP_MIN = 5;
const DRIFT_AMP_MAX = 13;
/** 节点漂移周期上下限（秒）。调大 → 更慢。 */
const DRIFT_PERIOD_MIN = 10;
const DRIFT_PERIOD_MAX = 25;
/** 呼吸缩放围绕 1 的振幅（scale ∈ 1±0.08 → 0.92~1.08）。 */
const BREATH_AMP = 0.08;
/** 呼吸周期上下限（秒）。 */
const BREATH_PERIOD_MIN = 6;
const BREATH_PERIOD_MAX = 12;
/** 呼吸透明度起伏（opacity ∈ [1-该值, 1]）。调大 → 闪烁更明显。 */
const BREATH_OPACITY = 0.16;
/** 鼠标影响半径（viewBox 单位）。调大 → 波及更远节点。 */
const POINTER_RADIUS = 170;
/** 鼠标对单节点的最大推挤位移（viewBox 单位，规范上限 25）。调大 → 更黏手。 */
const POINTER_MAX_OFFSET = 18;
/** 鼠标位移逼近目标的时间常数（秒），越小越跟手。 */
const POINTER_FOLLOW_TAU = 0.25;
/** 鼠标离开后回落到漂移轨道的时间常数（秒），越大回得越慢。 */
const POINTER_RETURN_TAU = 1.1;

/** 整体慢漂移 / 光点速度在 CSS：.graphDriftWrap(24s,±10px)、.graphFlow(dur 20~26s)。 */

/* =========================
   布局数据（坐标 = 旧静态 SVG 原样复用 + 少量扩展）
========================== */

interface GraphNodeDef {
  x: number;
  y: number;
  r: number;
  /** 扩展层：移动端由 CSS 隐藏。 */
  ext?: boolean;
}

// 0–4,6,7,9：原静态图的 5 个圆 + (500,105)/(540,125) 端点补节点；
// 2=(620,150) 也是端点。5/8 保留原大节点。10/11/12 为少量补充的扩展节点。
const NODES: GraphNodeDef[] = [
  { x: 335, y: 145, r: 12 }, // 0 原「左上」
  { x: 500, y: 105, r: 6 }, // 1 原线端点
  { x: 620, y: 150, r: 8 }, // 2 原线端点
  { x: 540, y: 125, r: 6 }, // 3 原虚线端点
  { x: 600, y: 335, r: 10 }, // 4 原「中间节点」
  { x: 905, y: 385, r: 15 }, // 5 原「右侧」
  { x: 335, y: 435, r: 10 }, // 6 原「左下」
  { x: 480, y: 360, r: 12 }, // 7 原「左下」
  { x: 815, y: 165, r: 7, ext: true }, // 8 右上补点（自 2 分叉，呼应「生长」）
  { x: 175, y: 300, r: 8, ext: true }, // 9 左侧补点
  { x: 1010, y: 470, r: 8, ext: true }, // 10 右下补点
];

interface GraphEdgeDef {
  a: number;
  b: number;
  dashed?: boolean;
  /** 信息流光点参数（CSS 驱动，端点仍由 rAF 跟随节点）。 */
  flow?: { dur: number; delay: number };
  ext?: boolean;
}

// 前 5 条与原静态图一一对应（含原虚线、原长线端点关系）；后 5 条为扩展层。
const EDGES: GraphEdgeDef[] = [
  { a: 0, b: 1, flow: { dur: 20, delay: -3 } }, // 原 335,145 → 500,105
  { a: 1, b: 2 }, // 原 500,105 → 620,150
  { a: 3, b: 4, dashed: true }, // 原虚线 540,125 → 600,335
  { a: 2, b: 5, flow: { dur: 22, delay: -8 } }, // 原长斜线 620,150 → 905,385
  { a: 6, b: 7, flow: { dur: 24, delay: -15 } }, // 原 335,435 → 480,360
  { a: 2, b: 8, ext: true },
  { a: 8, b: 5, ext: true },
  { a: 9, b: 0, ext: true },
  { a: 9, b: 6, dashed: true, ext: true },
  { a: 5, b: 10, ext: true },
];

const TAU = Math.PI * 2;

/** 每个节点的漂移/呼吸参数：按序号确定性派生（无随机 → SSR 与 CSR 一致、
 *  各节点相位/周期天然错开，不会同步呼吸）。幅度周期落在上面常量区间内。 */
const ANIM = NODES.map((_, i) => ({
  ampX: DRIFT_AMP_MIN + ((i * 3) % 10) * ((DRIFT_AMP_MAX - DRIFT_AMP_MIN) / 10),
  ampY: DRIFT_AMP_MIN + ((i * 5 + 2) % 10) * ((DRIFT_AMP_MAX - DRIFT_AMP_MIN) / 10),
  perX: DRIFT_PERIOD_MIN + ((i * 7 + 3) % 15) * ((DRIFT_PERIOD_MAX - DRIFT_PERIOD_MIN) / 15),
  perY: DRIFT_PERIOD_MIN + ((i * 5 + 7) % 15) * ((DRIFT_PERIOD_MAX - DRIFT_PERIOD_MIN) / 15),
  phaseX: i * 1.7,
  phaseY: i * 2.4 + 1.1,
  breathPer: BREATH_PERIOD_MIN + ((i * 3 + 1) % 6) * ((BREATH_PERIOD_MAX - BREATH_PERIOD_MIN) / 6),
  breathPhase: i * 2.1,
}));

function classNames(...xs: Array<string | false | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

export function KnowledgeGraphBackground() {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeRefs = useRef<Array<SVGGElement | null>>([]);
  const edgeRefs = useRef<Array<SVGLineElement | null>>([]);
  const flowRefs = useRef<Array<SVGLineElement | null>>([]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    // 鼠标交互只在桌面（宽 >768px 且细指针）启用；svg 自身始终 pointer-events:none。
    const finePointer = window.matchMedia("(pointer: fine) and (min-width: 769px)");

    let raf = 0;
    let last = 0;
    let vt = 0; // 虚拟秒数：暂停期间不推进，恢复时动作不跳变
    let pointer: { x: number; y: number } | null = null;

    const pos = NODES.map((n) => ({ x: n.x, y: n.y }));
    const offsets = NODES.map(() => ({ x: 0, y: 0 }));

    const line = (el: SVGLineElement | null, a: { x: number; y: number }, b: { x: number; y: number }) => {
      if (!el) return;
      el.setAttribute("x1", a.x.toFixed(2));
      el.setAttribute("y1", a.y.toFixed(2));
      el.setAttribute("x2", b.x.toFixed(2));
      el.setAttribute("y2", b.y.toFixed(2));
    };

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      vt += dt;

      for (let i = 0; i < NODES.length; i++) {
        const base = NODES[i];
        const p = ANIM[i];
        let x = base.x + p.ampX * Math.sin((TAU * vt) / p.perX + p.phaseX);
        let y = base.y + p.ampY * Math.sin((TAU * vt) / p.perY + p.phaseY);

        // 鼠标轻推：径向排斥、二次衰减；目标为 0 时用更长时间常数缓慢回落。
        let tx = 0;
        let ty = 0;
        if (pointer) {
          const vx = x - pointer.x;
          const vy = y - pointer.y;
          const d = Math.hypot(vx, vy);
          if (d < POINTER_RADIUS && d > 0.01) {
            const k = POINTER_MAX_OFFSET * Math.pow(1 - d / POINTER_RADIUS, 2);
            tx = (vx / d) * k;
            ty = (vy / d) * k;
          }
        }
        const o = offsets[i];
        const tau = tx === 0 && ty === 0 ? POINTER_RETURN_TAU : POINTER_FOLLOW_TAU;
        const blend = 1 - Math.exp(-dt / tau);
        o.x += (tx - o.x) * blend;
        o.y += (ty - o.y) * blend;
        x += o.x;
        y += o.y;
        pos[i].x = x;
        pos[i].y = y;

        const bph = (TAU * vt) / p.breathPer + p.breathPhase;
        const g = nodeRefs.current[i];
        if (g) {
          g.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(1 + BREATH_AMP * Math.sin(bph)).toFixed(3)})`);
          g.setAttribute("opacity", (1 - BREATH_OPACITY * (0.5 + 0.5 * Math.sin(bph + 2.2))).toFixed(3));
        }
      }

      for (let i = 0; i < EDGES.length; i++) {
        const e = EDGES[i];
        line(edgeRefs.current[i], pos[e.a], pos[e.b]);
        line(flowRefs.current[i], pos[e.a], pos[e.b]);
      }

      raf = requestAnimationFrame(step);
    };

    const start = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(step);
    };
    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };
    // reduced-motion 或页面隐藏 → 静态/暂停；JSX 里已是基准坐标，停帧即静止图谱。
    const sync = () => {
      if (reduce.matches || document.hidden) stop();
      else start();
    };
    sync();

    const onVisibility = () => sync();
    const onReduceChange = () => sync();
    document.addEventListener("visibilitychange", onVisibility);
    reduce.addEventListener("change", onReduceChange);

    let onMove: ((ev: PointerEvent) => void) | null = null;
    let onLeave: (() => void) | null = null;
    if (finePointer.matches) {
      onMove = (ev) => {
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
        pointer = { x: p.x, y: p.y };
      };
      onLeave = () => {
        pointer = null;
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("mouseleave", onLeave);
    }

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      reduce.removeEventListener("change", onReduceChange);
      if (onMove) window.removeEventListener("pointermove", onMove);
      if (onLeave) document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <svg
      aria-hidden
      className={styles.graph}
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 600"
      ref={svgRef}
    >
      {/* 整体极慢漂移（CSS graphDrift，~10px / 24s），第一眼察觉不到 */}
      <g className={styles.graphDriftWrap}>
        {EDGES.map((e, i) => {
          const a = NODES[e.a];
          const b = NODES[e.b];
          return (
            <Fragment key={i}>
              <line
                className={classNames(
                  e.dashed ? styles.graphLineDash : styles.graphLine,
                  e.ext && styles.graphExt,
                )}
                ref={(el) => {
                  edgeRefs.current[i] = el;
                }}
                x1={a.x}
                x2={b.x}
                y1={a.y}
                y2={b.y}
              />
              {e.flow && (
                <line
                  className={classNames(styles.graphFlow, e.ext && styles.graphExt)}
                  ref={(el) => {
                    flowRefs.current[i] = el;
                  }}
                  style={{ animationDelay: `${e.flow.delay}s`, animationDuration: `${e.flow.dur}s` }}
                  x1={a.x}
                  x2={b.x}
                  y1={a.y}
                  y2={b.y}
                />
              )}
            </Fragment>
          );
        })}
        {NODES.map((n, i) => (
          <g
            // 基准坐标先写进 JSX：无 JS / reduced-motion 下渲染的就是静态图谱
            key={i}
            className={classNames(n.ext && styles.graphExt)}
            ref={(el) => {
              nodeRefs.current[i] = el;
            }}
            transform={`translate(${n.x} ${n.y})`}
          >
            <circle className={styles.graphNode} cx={0} cy={0} r={n.r} />
          </g>
        ))}
      </g>
    </svg>
  );
}
