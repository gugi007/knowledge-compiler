"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import s from "@/app/space/space.module.css";
import type { GraphCanvasProps, GraphEdge, GraphNode } from "@/lib/frontend/graph";
import { RELATION_LABELS } from "@/lib/frontend/dataset";
import { domainColorMap, domainOrderOf, DOMAIN_FALLBACK } from "./_lib/domain-colors";
import { LatexText } from "../latex-text";
import { CANVAS_HEIGHT, CANVAS_WIDTH, computeLayout } from "./_lib/layout";

/**
 * 画布对外的扩展 props。
 *
 * 契约里（lib/frontend/graph.ts 的 GraphCanvasProps）只有「移除式筛选」的
 * visibleDomains；第三幕参考稿需要的是「变暗不删除」。这里用本地扩展类型吸收
 * 新增的渲染态，不改共享契约——批次 3 的调用方切过来之前，两套语义并存：
 * - visibleDomains：仍按旧行为把领域外的节点/边整个抽掉；
 * - dimmedDomains：保留节点，只把命中领域的节点压到 opacity .35。
 */
export type SpaceGraphProps = GraphCanvasProps & {
  /** 需要「变暗」的领域：节点保留但降透明度（不删除）。 */
  dimmedDomains?: readonly string[];
  /** 本次增量编译新增的节点 id：淡入 + 脉冲光环 + NEW 角标。 */
  newNodeIds?: readonly string[];
  /** 本次增量编译被改写的节点 id：挂 UPDATED 角标（绿色 #1E7E34）。 */
  updatedNodeIds?: readonly string[];
  /** 本次增量编译新增的边 id：淡入点亮。 */
  newEdgeIds?: readonly string[];
  /** 聚焦新增：非新增元素压到 opacity .18（挂在 stage 上的氛围态）。 */
  focusNew?: boolean;
  /** 编译进行中：非新增元素压到 opacity .5（挂在 stage 上的氛围态）。 */
  compiling?: boolean;
  /**
   * 画布内浮层：渲染在 `.stage` 内部（参考稿里 `.evo-fab` 就贴在 stage 左下角）。
   * 第三幕用它挂「知识演变」回放胶囊，位置因此跟着画布而不是浏览器视口走。
   */
  overlay?: ReactNode;
  /** 正在浏览的阅读路径：概念按顺序连成「航线」。顺序即数组顺序。 */
  pathNodeIds?: readonly string[];
  /** 受控：当前选中的边 id（由右侧关系列表触发，画布上不再直接点线）。 */
  selectedEdgeId?: string;
  /** 选中边变化回调（点节点/空白时传 undefined 清除）。 */
  onEdgeSelect?: (id: string | undefined) => void;
};

const CROSS_DOMAIN_STROKE = "#D8DCE3";

/**
 * 航线的统一色。刻意不取领域色：路径会横跨多个领域，用领域色会与真实关系边
 * 同色难辨；这里用一个比配色池更饱和的暖色（池内饱和上限 60%、明度 50–58%），
 * 配上更粗的线宽与箭头，与「领域色实线 / 灰虚线」两种真实边在观感上分开。
 */
const ROUTE_STROKE = "#E8590C";

/** 航线箭头 marker 的 id：同一页面即使挂了两个画布，重复 id 也只会命中等价定义。 */
const ROUTE_ARROW_ID = "kc-route-arrow";

/** 领域色 → 指定 alpha 的填充色（参考稿节点是极淡的领域色底 + 同色描边）。 */
function nodeFill(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map((char) => char + char).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return `rgb(133 144 166 / ${alpha})`;
  const value = Number.parseInt(full, 16);
  return `rgb(${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255} / ${alpha})`;
}

/** 半径收敛：斜率 2→1.5、上限 30→26，文章多的概念不再是一个碾压式的大实心球。 */
function nodeRadius(node: GraphNode): number {
  return Math.min(26, 14 + node.articleCount * 1.5);
}

const TAU = Math.PI * 2;

/**
 * 边的柔和曲线：两端从节点圆外沿起画（不穿节点），中间加一个垂直方向的二次曲线
 * 控制点。bend 正负决定弯向哪边，由边 id hash 决定，避免所有边同向弯。
 */
function edgeCurve(
  a: { x: number; y: number },
  aR: number,
  b: { x: number; y: number },
  bR: number,
  bend: number,
): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const x1 = a.x + ux * (aR + 1);
  const y1 = a.y + uy * (aR + 1);
  const x2 = b.x - ux * (bR + 1);
  const y2 = b.y - uy * (bR + 1);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const cx = mx - uy * bend;
  const cy = my + ux * bend;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} Q${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** 边 id → 弯曲方向（±10px），确定性 hash。 */
function edgeBend(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h % 2 === 0 ? 1 : -1) * 9;
}

/**
 * 航线端点：两端各从节点外沿起画。
 *
 * 为什么要内缩而不是直接连圆心：节点圆画在边的后面，从圆心起画的话线段会横穿
 * 半透明节点内部，箭头也会被节点圆盖住。节点挨得极近时按线段长度比例退让，
 * 避免内缩量超过线段长度而画出反向线。
 */
function routeSegment(
  from: { x: number; y: number },
  fromRadius: number,
  to: { x: number; y: number },
  toRadius: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const head = Math.min(fromRadius + 3, length * 0.3);
  const tail = Math.min(toRadius + 5, length * 0.4);
  return {
    x1: from.x + ux * head,
    y1: from.y + uy * head,
    x2: to.x - ux * tail,
    y2: to.y - uy * tail,
  };
}

/** 兜底截断：阈值放到 14 是为了让 demo 语料里那些长英文名完整显示，
 *  hover 的 <title> 才是完整名字的出口。 */
function labelOf(name: string): string {
  return name.length > 14 ? `${name.slice(0, 14)}…` : name;
}

/** 只有布局/数据真为空时才需要，兜底一个合法的空集合。 */
const EMPTY: readonly string[] = [];

export function GraphCanvas({
  data,
  selectedNodeId,
  visibleDomains,
  highlightedNodeIds,
  onNodeSelect,
  onEdgeSelect,
  dimmedDomains,
  newNodeIds,
  updatedNodeIds,
  newEdgeIds,
  focusNew,
  compiling,
  overlay,
  pathNodeIds,
  selectedEdgeId,
}: SpaceGraphProps) {
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<{ px: number; py: number } | null>(null);

  // 领域色按「领域首次出现序」发色，与左栏图例共用 domainOrderOf：
  // 两处若各自决定顺序，同一领域就会在画布和图例里不同色（历史 bug）。
  const colors = useMemo(() => domainColorMap(domainOrderOf(data.nodes)), [data.nodes]);

  // ---- 旧语义：visibleDomains 仍是「移除」，批次 3 才会换成 dimmedDomains ----
  const visible = visibleDomains?.length
    ? data.nodes.filter((node) => visibleDomains.includes(node.domain))
    : data.nodes;
  const visibleIds = useMemo(() => new Set(visible.map(({ id }) => id)), [visible]);
  const edges = data.edges.filter(
    (edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId),
  );
  const layout = useMemo(() => computeLayout(visible), [visible]);

  // ---- 新语义：dimmedDomains 只降透明度，节点继续留在画布上 ----
  const dimmedSet = useMemo(() => new Set(dimmedDomains ?? EMPTY), [dimmedDomains]);
  const newNodes = useMemo(() => new Set(newNodeIds ?? EMPTY), [newNodeIds]);
  const updatedNodes = useMemo(() => new Set(updatedNodeIds ?? EMPTY), [updatedNodeIds]);
  const newEdges = useMemo(() => new Set(newEdgeIds ?? EMPTY), [newEdgeIds]);

  // highlightedNodeIds 是批次 0 就有的「新增」提示，与 newNodeIds 取并集。
  const highlighted = useMemo(() => new Set(highlightedNodeIds ?? EMPTY), [highlightedNodeIds]);

  const nodeById = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes]);

  const focusEdgeIds = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const ids = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId) ids.add(edge.id);
    }
    return ids;
  }, [edges, selectedNodeId]);

  /** 选中概念的「自己 + 邻居」，用于把图面其余部分压暗。 */
  const focusNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedNodeId) return ids;
    ids.add(selectedNodeId);
    for (const edge of edges) {
      if (edge.sourceId === selectedNodeId) ids.add(edge.targetId);
      else if (edge.targetId === selectedNodeId) ids.add(edge.sourceId);
    }
    return ids;
  }, [edges, selectedNodeId]);

  const selectedEdge: GraphEdge | undefined = selectedEdgeId
    ? edges.find(({ id }) => id === selectedEdgeId)
    : undefined;

  // ---- 阅读路径「航线」 ----
  // 单点的路径不构成航线（画不出线段），所以要求 size > 1。
  const pathSet = useMemo(() => new Set(pathNodeIds ?? EMPTY), [pathNodeIds]);
  const pathActive = pathSet.size > 1;
  /**
   * 航线顶点：按 pathNodeIds 的数组顺序取坐标，缺布局坐标的点直接丢弃
   * （「知识演变」回放会把未揭示的节点从 data 里过滤掉，路径上的点在回放中
   * 可能还不存在）。顺序即数组顺序，是这条路径的表达本身。
   */
  const routePoints = useMemo(() => {
    if (!pathActive) return [];
    return (pathNodeIds ?? EMPTY).flatMap((id) => {
      const point = layout.positions.get(id);
      const node = nodeById.get(id);
      return point && node ? [{ node, point }] : [];
    });
  }, [pathActive, pathNodeIds, layout, nodeById]);

  /** 路径节点 → 步序（1-based），用于节点左上角叠序号 badge。 */
  const pathIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!pathActive) return m;
    (pathNodeIds ?? EMPTY).forEach((id, i) => {
      if (!m.has(id)) m.set(id, i + 1);
    });
    return m;
  }, [pathActive, pathNodeIds]);

  /* ---- login 式呼吸：节点慢漂移 + 缩放，边端点逐帧跟随 ----
     幅度刻意比 login 背景小（漂移 ±4px、scale ±4%），因为这是工作台不是装饰层。
     选中节点 / hover 节点 / 走航线时静止（视觉焦点不动）。 */
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef(new Map<string, SVGPathElement>());
  const hoverIdRef = useRef<string | null>(null);

  function animHash(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return (((h >>> 0) % 10000) / 10000) * 2 - 1;
  }

  const animParams = useMemo(() => {
    const m = new Map<string, { ax: number; ay: number; px: number; py: number; phx: number; phy: number; bp: number; bph: number }>();
    for (const node of visible) {
      m.set(node.id, {
        ax: 2 + Math.abs(animHash(`${node.id}::ax`)) * 3,
        ay: 2 + Math.abs(animHash(`${node.id}::ay`)) * 3,
        px: 12 + Math.abs(animHash(`${node.id}::px`)) * 10,
        py: 12 + Math.abs(animHash(`${node.id}::py`)) * 10,
        phx: animHash(`${node.id}::phx`) * TAU,
        phy: animHash(`${node.id}::phy`) * TAU,
        bp: 6 + Math.abs(animHash(`${node.id}::bp`)) * 6,
        bph: animHash(`${node.id}::bph`) * TAU,
      });
    }
    return m;
  }, [visible]);

  useEffect(() => {
    // 走航线时节点静止（航线是视觉焦点），reduced-motion 也静止。
    if (pathActive) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let last = 0;
    let vt = 0;
    const offsets = new Map<string, { dx: number; dy: number }>();

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      vt += dt;

      for (const node of visible) {
        const el = nodeEls.current.get(node.id);
        const p = animParams.get(node.id);
        const point = layout.positions.get(node.id);
        if (!el || !p || !point) continue;
        const paused = node.id === selectedNodeId || node.id === hoverIdRef.current;
        const dx = paused ? 0 : p.ax * Math.sin((TAU * vt) / p.px + p.phx);
        const dy = paused ? 0 : p.ay * Math.sin((TAU * vt) / p.py + p.phy);
        const s = paused ? 1 : 1 + 0.04 * Math.sin((TAU * vt) / p.bp + p.bph);
        offsets.set(node.id, { dx, dy });
        el.setAttribute(
          "transform",
          `translate(${(point.x + dx).toFixed(2)} ${(point.y + dy).toFixed(2)}) scale(${s.toFixed(3)})`,
        );
      }

      for (const edge of edges) {
        const el = edgeEls.current.get(edge.id);
        if (!el) continue;
        const sp = layout.positions.get(edge.sourceId);
        const tp = layout.positions.get(edge.targetId);
        if (!sp || !tp) continue;
        const sOff = offsets.get(edge.sourceId) ?? { dx: 0, dy: 0 };
        const tOff = offsets.get(edge.targetId) ?? { dx: 0, dy: 0 };
        const sNode = nodeById.get(edge.sourceId);
        const tNode = nodeById.get(edge.targetId);
        const d = edgeCurve(
          { x: sp.x + sOff.dx, y: sp.y + sOff.dy },
          sNode ? nodeRadius(sNode) : 16,
          { x: tp.x + tOff.dx, y: tp.y + tOff.dy },
          tNode ? nodeRadius(tNode) : 16,
          edgeBend(edge.id),
        );
        el.setAttribute("d", d);
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
    const sync = () => {
      if (document.hidden) stop();
      else start();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [visible, edges, layout, animParams, selectedNodeId, pathActive, nodeById]);

  const domainLegend = useMemo(() => {
    const seen = new Map<string, number>();
    for (const node of visible) seen.set(node.domain, (seen.get(node.domain) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  /**
   * 氛围态：compiling / focusNew 是「二次编译」这条流程的压暗，与阅读路径是两个
   * 互不相关的流程。走航线时两者一起摘掉，压暗交给航线自己的行内 opacity——
   * 两套叠加会把非路径节点压到看不清，而这正是本次要修的那类叠加 bug。
   */
  const stageClass = [
    s.stage,
    compiling && !pathActive ? s.compiling : "",
    focusNew && !pathActive ? s.focusNew : "",
  ]
    .filter(Boolean)
    .join(" ");

  const nodeSelector = s.gNode ? `.${s.gNode}` : "[data-graph-node]";

  return (
    /* 中栏本体就是一个 flex 列：工具条固定 + .stage 靠 flex:1 撑满剩余高度
       （参考稿 .canvas-col / .stage 的规则；栏高由 .workspace 的 100vh-140px 给）。 */
    <div className={s.canvasPanel}>
      <div className={s.canvasToolbar}>
        <div className={s.legend}>
          {domainLegend.map(([domain, count]) => (
            <span
              className={dimmedSet.has(domain) ? `${s.legendItem} ${s.dim}` : s.legendItem}
              key={domain}
            >
              <i
                aria-hidden
                className={s.legendDot}
                style={{ background: colors.get(domain) ?? DOMAIN_FALLBACK }}
              />
              {domain}
              <span style={{ color: "var(--faint)", fontVariantNumeric: "tabular-nums" }}>
                {count}
              </span>
            </span>
          ))}
        </div>
        <div className={s.zoom}>
          <button
            aria-label="缩小"
            className={s.zoomBtn}
            onClick={() => setView((v) => ({ ...v, k: Math.max(0.5, v.k / 1.2) }))}
            type="button"
          >
            −
          </button>
          <span className={s.zoomPct}>{Math.round(view.k * 100)}%</span>
          <button
            aria-label="放大"
            className={s.zoomBtn}
            onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))}
            type="button"
          >
            +
          </button>
        </div>
      </div>

      {/* 不再给 stage 任何固定高度：.canvasPanel 是 flex 列、.stage 是 flex:1，
          画布因此随中栏栏高撑满（<lg 断点下 .stage 自己退化成 60vh / 52vh）。 */}
      <div className={stageClass}>
        <svg
          aria-label="知识图谱画布"
          className={s.stageSvg}
          onMouseDown={(event) => {
            if ((event.target as Element).closest(nodeSelector)) return;
            // 点空白处（不是节点）时关掉证据浮层。
            onEdgeSelect?.(undefined);
            setDrag({ px: event.clientX - view.x, py: event.clientY - view.y });
          }}
          onMouseLeave={() => setDrag(null)}
          onMouseMove={(event) => {
            if (!drag) return;
            setView((v) => ({ ...v, x: event.clientX - drag.px, y: event.clientY - drag.py }));
          }}
          onMouseUp={() => setDrag(null)}
          onWheel={(event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            const factor = event.deltaY > 0 ? 1 / 1.12 : 1.12;
            setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.5, v.k * factor)) }));
          }}
          preserveAspectRatio="xMidYMid meet"
          role="application"
          style={{ cursor: drag ? "grabbing" : "grab" }}
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {layout.clusters.map(({ domain, label }) => (
              <text
                className={s.clusterLabel}
                key={domain}
                opacity={dimmedSet.has(domain) ? 0.55 : 1}
                textAnchor="middle"
                x={label.x}
                y={label.y}
              >
                {domain}
              </text>
            ))}

            {/* 航线打底：路径相邻概念平均只有一半真的有关系边（实测 2/3、4/7、3/4），
                所以顺序本身用独立折线画出来，不做成边、也不冒充数据。真实关系边随后
                叠在上面，重合处就是一条被数据支撑的实线。 */}
            {pathActive && routePoints.length > 1 && (
              <g>
                {/* 箭头让方向可读：折线的每一段都指向「下一个概念」，marker 用
                    userSpaceOnUse 固定 7px，否则会被 strokeWidth 放大成 18px。 */}
                <defs>
                  <marker
                    id={ROUTE_ARROW_ID}
                    markerHeight={7}
                    markerUnits="userSpaceOnUse"
                    markerWidth={7}
                    orient="auto"
                    refX={6.5}
                    refY={3.5}
                    viewBox="0 0 7 7"
                  >
                    <path d="M0 0 L7 3.5 L0 7 Z" fill={ROUTE_STROKE} />
                  </marker>
                </defs>
                {routePoints.slice(1).map((current, index) => {
                  const previous = routePoints[index]!;
                  const segment = routeSegment(
                    previous.point,
                    nodeRadius(previous.node),
                    current.point,
                    nodeRadius(current.node),
                  );
                  // 航线也弯一点，方向奇偶交替，像流动的线。
                  const bend = (index % 2 === 0 ? 1 : -1) * 8;
                  const mx = (segment.x1 + segment.x2) / 2;
                  const my = (segment.y1 + segment.y2) / 2;
                  const dx = segment.x2 - segment.x1;
                  const dy = segment.y2 - segment.y1;
                  const len = Math.hypot(dx, dy) || 1;
                  const cx = mx - (dy / len) * bend;
                  const cy = my + (dx / len) * bend;
                  return (
                    <path
                      className={s.routeEdge}
                      d={`M${segment.x1} ${segment.y1} Q${cx.toFixed(2)} ${cy.toFixed(2)} ${segment.x2} ${segment.y2}`}
                      key={current.node.id}
                      markerEnd={`url(#${ROUTE_ARROW_ID})`}
                      stroke={ROUTE_STROKE}
                      strokeWidth={2.6}
                    />
                  );
                })}
              </g>
            )}

            {edges.map((edge) => {
              const source = layout.positions.get(edge.sourceId);
              const target = layout.positions.get(edge.targetId);
              if (!source || !target) return null;
              const sourceNode = nodeById.get(edge.sourceId);
              const targetNode = nodeById.get(edge.targetId);
              const color = colors.get(sourceNode?.domain ?? "") ?? DOMAIN_FALLBACK;
              // 领域内边：实线、用领域色；跨领域边：灰色虚线。
              const intraDomain = sourceNode?.domain === targetNode?.domain;
              const active = selectedEdgeId === edge.id;
              const isNewEdge = newEdges.has(edge.id);
              // 与节点同款判别式：领域视图下，两端都在当前领域的边保持原样，
              // 其余压到 .35（与节点的领域压暗同值，领域外是「变暗」不是「消失」）；
              // 只有「全部领域」模式（dimmedSet 为空）才用节点聚焦压暗。
              const inActiveDomain =
                !dimmedSet.size ||
                (!dimmedSet.has(sourceNode?.domain ?? "") &&
                  !dimmedSet.has(targetNode?.domain ?? ""));
              // 优先级：航线 > 领域视图 > 节点聚焦。
              const onPath = pathSet.has(edge.sourceId) && pathSet.has(edge.targetId);
              const faded = pathActive
                ? !onPath
                : dimmedSet.size
                  ? !inActiveDomain && !active
                  : focusEdgeIds !== undefined && !focusEdgeIds.has(edge.id) && !active;
              // 基础可见度：领域内实线 .7、选中 1、跨领域灰虚线 .5（簇间交叉不抢视线）。
              const baseOpacity = intraDomain && !active ? 0.7 : active ? 1 : 0.5;
              // 压暗值：走航线时不在路径上的边压到 .12（航线优先于领域视图）。
              const fadeOpacity = pathActive ? 0.12 : dimmedSet.size ? 0.35 : 0.12;
              const opacity = pathActive && onPath ? 1 : faded ? fadeOpacity : baseOpacity;
              // 路径上的真实边加粗到与航线同宽：重合时是一条实线，不是两条。
              const strokeWidth =
                pathActive && onPath ? 2.6 : active ? 2.4 : intraDomain ? 1.4 : 1.1;
              const sR = sourceNode ? nodeRadius(sourceNode) : 16;
              const tR = targetNode ? nodeRadius(targetNode) : 16;
              const bend = edgeBend(edge.id);
              const d = edgeCurve(source, sR, target, tR, bend);
              return (
                <g key={edge.id}>
                  <path
                    className={isNewEdge ? `${s.edgeNew} ${s.on}` : undefined}
                    // 新增边靠 .edgeNew.on 的 CSS 控制显隐，行内 opacity 会压过类，
                    // 因此只在非新增边上用 opacity 属性做聚焦淡化。
                    d={d}
                    fill="none"
                    opacity={isNewEdge ? undefined : opacity}
                    ref={(el) => {
                      if (el) edgeEls.current.set(edge.id, el);
                      else edgeEls.current.delete(edge.id);
                    }}
                    stroke={intraDomain || active ? color : CROSS_DOMAIN_STROKE}
                    strokeDasharray={intraDomain && !active ? undefined : "4 4"}
                    strokeWidth={strokeWidth}
                  />
                </g>
              );
            })}

            {visible.map((node) => {
              const point = layout.positions.get(node.id);
              if (!point) return null;
              const active = node.id === selectedNodeId;
              const isNew = newNodes.has(node.id) || highlighted.has(node.id);
              const isUpdated = !isNew && updatedNodes.has(node.id);
              const radius = nodeRadius(node);
              const color = colors.get(node.domain) ?? DOMAIN_FALLBACK;

              const focusFaded = selectedNodeId !== undefined && !focusNodeIds.has(node.id);
              const domainFaded = dimmedSet.has(node.domain);
              const pathFaded = pathActive && !pathSet.has(node.id);
              // 优先级：航线 > 领域视图 > 节点聚焦。
              // 领域视图与节点聚焦互斥，判别式是 dimmedSet.size：用户在选某个领域时
              // 走纯领域视图（当前领域全亮、其余 .35），节点聚焦让位；只有「全部领域」
              // 模式（dimmedSet 为空）才由节点聚焦压暗。两者若叠加，当前领域内非邻居
              // 节点会被压到 .25，比领域外的 .35 还暗（历史 bug）。
              // 变暗不删除：命中 dimmedDomains 的节点保留在图面上，只压到 .35。
              const opacity = pathFaded
                ? 0.18
                : dimmedSet.size
                  ? domainFaded
                    ? 0.35
                    : 1
                  : focusFaded
                    ? 0.25
                    : 1;

              const classes = [s.gNode];
              if (isNew) classes.push(s.newNode, s.on);

              return (
                <g
                  aria-label={`查看概念 ${node.name}`}
                  className={classes.join(" ")}
                  data-graph-node=""
                  key={node.id}
                  onClick={() => {
                    onEdgeSelect?.(undefined);
                    onNodeSelect?.(node.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onNodeSelect?.(node.id);
                    }
                  }}
                  onMouseEnter={() => {
                    hoverIdRef.current = node.id;
                  }}
                  onMouseLeave={() => {
                    if (hoverIdRef.current === node.id) hoverIdRef.current = null;
                  }}
                  // 新增节点由 .newNode.on 控制显隐，行内属性会被类压过，故不重复设置。
                  opacity={isNew ? undefined : opacity}
                  ref={(el) => {
                    if (el) nodeEls.current.set(node.id, el);
                    else nodeEls.current.delete(node.id);
                  }}
                  role="button"
                  tabIndex={0}
                  transform={`translate(${point.x} ${point.y})`}
                >
                  {isNew && (
                    <circle
                      className={s.halo}
                      fill="none"
                      r={radius}
                      stroke={color}
                      strokeWidth={1.5}
                    />
                  )}
                  {active && (
                    <circle
                      fill="none"
                      opacity={0.18}
                      r={radius + 10}
                      stroke={color}
                      strokeWidth={1}
                    />
                  )}
                  <circle
                    className={s.gBody}
                    fill={active ? color : nodeFill(color, 0.12)}
                    r={radius}
                    stroke={color}
                    strokeWidth={active ? 2.0 : 1.8}
                  />
                  {/* 阅读路径步序 badge：叠在节点左上角，当前步实心领域色、其余白底。 */}
                  {pathActive && pathIndexMap.has(node.id) && (
                    <g transform={`translate(${-radius * 0.72} ${-radius * 0.72})`}>
                      <circle
                        fill={active ? color : "#fff"}
                        r={8}
                        stroke={color}
                        strokeWidth={1.2}
                      />
                      <text
                        dominantBaseline="central"
                        fill={active ? "#fff" : color}
                        fontSize="9"
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        {pathIndexMap.get(node.id)}
                      </text>
                    </g>
                  )}
                  <text
                    className={active ? `${s.gLabel} ${s.sel}` : s.gLabel}
                    textAnchor="middle"
                    y={radius + 13}
                  >
                    {/* 原生 tooltip：标签可能被 labelOf 截断，完整名字挂在 title 上。 */}
                    <title>{node.name}</title>
                    {labelOf(node.name)}
                  </text>
                  {isNew && (
                    <text
                      className={`${s.newTag} ${s.updated}`}
                      textAnchor="middle"
                      y={-radius - 8}
                    >
                      NEW
                    </text>
                  )}
                  {isUpdated && (
                    <text
                      className={s.updatedTag}
                      textAnchor="middle"
                      y={-radius - 8}
                    >
                      UPDATED
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* 参考稿的 .evo-fab 就落在 .stage 内部，所以画布内的浮层由这里承接。 */}
        {overlay}
      </div>

      {selectedEdge && (
        <div className={s.edgePanel}>
          <div className={s.edgePanelHead}>
            <p className={s.edgePanelTitle}>
              <span className={s.edgeKind}>{RELATION_LABELS[selectedEdge.kind]}</span>
              证据引文 · 置信度 {Math.round(selectedEdge.confidence * 100)}%
            </p>
            <button
              aria-label="关闭证据"
              className={s.edgeClose}
              onClick={() => onEdgeSelect?.(undefined)}
              type="button"
            >
              ✕
            </button>
          </div>
          {selectedEdge.evidenceQuotes.length ? (
            <ul className={s.edgeList}>
              {selectedEdge.evidenceQuotes.map((quote, index) => (
                <li className={s.edgeQuote} key={index}>
                  <LatexText>{`“${quote}”`}</LatexText>
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.edgeEmpty}>这条关系没有可展示的原文引文。</p>
          )}
        </div>
      )}
    </div>
  );
}
