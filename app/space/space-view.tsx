"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { CompiledKnowledgeDataset, Concept } from "@/data/models";
import { useActiveDataset } from "@/app/_shared/hooks/use-active-dataset";
import {
  buildGraphData,
  conceptsByDomain,
  PATH_LEVEL_LABELS,
  summarize,
} from "@/lib/frontend/dataset";
import { ROUTES } from "@/lib/frontend/routes";
import s from "./space.module.css";
import { ConceptCard } from "./concept-card";
import { absorbedInto, EditBar, type ConceptEdit, type EditMap } from "./edit-mode";
import { domainColorMap, domainOrderOf, DOMAIN_FALLBACK } from "./graph/_lib/domain-colors";
import { GraphCanvas } from "./graph/graph-canvas";
import { RecompileBar } from "./recompile-bar";
import { useRecompileDemo } from "./recompile-demo-data";
import { TimelinePlayer, type TimelineState } from "./timeline-player";

/**
 * 第三幕「知识空间」的页面骨架（批次 3/5）。
 *
 * 与批次 0 的差别：不再套共享 PageShell，改用 space.module.css 里的本地骨架
 * （.shell / .topbar / .workspace），三栏工作区各自独立滚动。领域筛选也从
 * 「移除式」（visibleDomains，领域外节点直接消失）改成「变暗式」
 * （dimmedDomains，领域外节点保留但降透明度）。
 */

/** 领域筛选语义：选中某领域时，把「其余领域」交给画布降透明度（不是隐藏）。 */
function otherDomains(all: readonly string[], selected: string | undefined) {
  if (!selected) return undefined;
  return all.filter((domain) => domain !== selected);
}

/**
 * 三态领域筛选 → 当前领域。
 * `null` 是「用户显式选了全部领域」，因此优先判空；其余情况跟随用户选择，
 * 用户还没动过（`undefined`）时回落到当前选中概念的领域。
 */
function resolveDomain(
  selected: string | null | undefined,
  fallback: string | undefined,
): string | undefined {
  if (selected === null) return undefined;
  return selected ?? fallback;
}

/** 只有「成熟的作者空间」这份语料走二次编译演示，其它来源一律不渲染状态条。 */
const RECOMPILE_DEMO_SOURCE_ID = "bayes";

export function SpaceView() {
  const { dataset, corpus, sourceId } = useActiveDataset();
  /**
   * 领域筛选。三态，与下面 selectedConceptId 保持同一套写法：
   * - `undefined`：用户还没动过筛选 → 跟随「当前选中概念」的领域（落地默认选中时
   *   左栏就有一个 .active 领域，图例其余领域 dim，与参考稿一致）；
   * - `string`：用户手动点了某个领域（显式筛选，不随选中概念变化）；
   * - `null`：用户显式点了「全部领域」→ 高亮清除、图例不再 dim、画布恢复全亮。
   */
  const [selectedDomain, setSelectedDomain] = useState<string | null | undefined>();
  /**
   * 右栏选中项。三态：
   * - `undefined`：用户还没选过 → 走「落地默认选中」（参考稿一进页面右栏就是满的）；
   * - `string`：用户在画布/关系网络里点开过某个概念；
   * - `null`：用户显式关掉了右栏（小屏抽屉的关闭/遮罩），不再回落到默认选中。
   */
  const [selectedConceptId, setSelectedConceptId] = useState<string | null | undefined>();
  const [selectedPathId, setSelectedPathId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<EditMap>(new Map());
  const [cursor, setCursor] = useState(-1);
  const [timeline, setTimeline] = useState<TimelineState>();
  /** 本会话在右栏打开过的概念 id（仅内存，不做持久化），用于阅读路径进度。 */
  const [openedConceptIds, setOpenedConceptIds] = useState<ReadonlySet<string>>(() => new Set());
  /** done 态点「查看新增」后的聚焦态（纯前端演示，不落盘）。 */
  const [peekNew, setPeekNew] = useState(false);

  const absorbed = useMemo(() => absorbedInto(edits), [edits]);
  /**
   * 编辑后的概念表：过滤掉被删除/被收入它物的概念。左栏领域行、领域配色与画布
   * 都以它为准，「概念被删空的领域」因此会从三处一起消失，不再出现「图例有色点、
   * 画布没有节点」的错位。定义必须排在 groups / colors 之前，后两者由它派生。
   */
  const displayConcepts = useMemo(
    () =>
      dataset.concepts
        .filter((concept) => !edits.get(concept.id)?.deleted && !absorbed.has(concept.id))
        .map((concept) => {
          const edit = edits.get(concept.id);
          if (!edit) return concept;
          return {
            ...concept,
            name: edit.renamedTo ?? concept.name,
            summary: edit.summaryOverride ?? concept.summary,
          };
        }),
    [dataset.concepts, edits, absorbed],
  );

  const summary = useMemo(() => summarize(dataset), [dataset]);
  /**
   * 左栏领域行。用 displayConcepts 而不是 dataset.concepts：否则被编辑删空的领域
   * 仍留在图例里，而画布上已经没有它的节点。行序仍是 conceptsByDomain 的
   * 「概念数降序」，那只是展示顺序，与配色无关。
   */
  const groups = useMemo(
    () => conceptsByDomain({ ...dataset, concepts: displayConcepts }),
    [dataset, displayConcepts],
  );
  /** 领域清单，与 groups 同集合同序；供 otherDomains 的 dimming 输入使用。 */
  const allDomains = useMemo(() => groups.map(({ domain }) => domain), [groups]);
  /**
   * 领域色：与画布**同源同序**——都取 displayConcepts 的领域首次出现序。
   * 不能拿 allDomains 当输入：那是 conceptsByDomain 的「概念数降序」（还用
   * localeCompare 打破平局），与画布序不同，两处会分叉、同一领域不同色。
   * 也不能用未过滤的 dataset.concepts：编辑态下被删空的领域会让其后领域整体
   * 移位换色，再次与画布异色。
   */
  const colors = useMemo(
    () => domainColorMap(domainOrderOf(displayConcepts)),
    [displayConcepts],
  );

  const graphDataset = useMemo<CompiledKnowledgeDataset>(
    () => ({ ...dataset, concepts: displayConcepts }),
    [dataset, displayConcepts],
  );
  const graph = useMemo(() => buildGraphData(graphDataset), [graphDataset]);

  /**
   * 落地默认选中：取「领域分组顺序」里的第一个概念（同一份 dataset 上顺序稳定：
   * 领域按概念数降序、领域内按证据文章数 → 置信度 → id）。用 displayConcepts 而不是
   * dataset.concepts，避免默认选中一个已被编辑删掉的概念。
   */
  const defaultConceptId = useMemo(() => {
    const grouped = conceptsByDomain({ ...dataset, concepts: displayConcepts });
    return grouped[0]?.concepts[0]?.id;
  }, [dataset, displayConcepts]);

  const activeConceptId =
    selectedConceptId === null ? undefined : (selectedConceptId ?? defaultConceptId);
  const selected: Concept | undefined = activeConceptId
    ? displayConcepts.find(({ id }) => id === activeConceptId)
    : undefined;
  const effectiveSelectedId = selected ? activeConceptId : undefined;

  const playing = cursor >= 0;

  /**
   * 当前领域：显式选了就是它；显式选了「全部」就是 undefined；没动过则跟随
   * 当前选中概念的领域。左栏 .active、图例 dim 与画布压暗都从这一个值派生。
   */
  // 不 memo：otherDomains 只是一次小数组 filter，且 activeDomain 来自未 memo 的
  // `selected`，包 useMemo 反而让 React Compiler 放弃整个组件的优化。
  const activeDomain = resolveDomain(selectedDomain, selected?.domain);
  const dimmedDomains = otherDomains(allDomains, activeDomain);

  // ------------------------------------------------ 二次编译演示（批次 4/5）
  // 只在 bayes 这份语料上启用；enabled 为 false 时 hook 完全惰性，
  // 下面所有派生量都退化成「没有新增 / 不在编译」，不影响批次 3 的既有行为。
  const recompile = useRecompileDemo({ dataset, enabled: sourceId === RECOMPILE_DEMO_SOURCE_ID });
  const recompileRunning = recompile.phase === "running";
  const recompileIdle = recompile.phase === "idle";
  /** 新节点/新边只有到「图谱生成」这一步才交给画布，让淡入与光环能被看见。 */
  const revealNew = !recompileIdle && (recompile.phase === "done" || recompile.stepIndex >= 2);
  const focusNew = revealNew && (recompileRunning || peekNew);
  const newConceptNames = useMemo(() => {
    if (!recompile.newNodeIds.length) return [];
    const index = new Map(dataset.concepts.map((concept) => [concept.id, concept.name]));
    return recompile.newNodeIds
      .map((id) => index.get(id))
      .filter((name): name is string => Boolean(name));
  }, [dataset.concepts, recompile.newNodeIds]);

  /**
   * 阅读路径进度：本会话打开过的概念 ∩ 路径概念（初始 0，不落盘）。
   * 只用于左栏阅读路径条下方进度条的宽度百分比，不再参与任何文案渲染。
   */
  const pathProgress = useMemo(() => {
    const done = new Map<string, number>();
    for (const path of dataset.readingPaths) {
      done.set(path.id, path.conceptIds.filter((id) => openedConceptIds.has(id)).length);
    }
    return done;
  }, [dataset.readingPaths, openedConceptIds]);

  const playbackGraph = useMemo(() => {
    if (!playing || !timeline) return graph;
    const revealed = new Set(timeline.revealedIds);
    return {
      nodes: graph.nodes.filter((node) => revealed.has(node.id)),
      edges: graph.edges.filter(
        (edge) => revealed.has(edge.sourceId) && revealed.has(edge.targetId),
      ),
    };
  }, [graph, playing, timeline]);

  const highlightedIds = playing ? timeline?.freshIds : undefined;
  const onTimelineChange = useCallback((state: TimelineState) => setTimeline(state), []);
  const applyEdit = useCallback((id: string, edit: ConceptEdit) => {
    setEdits((previous) => {
      const next = new Map(previous);
      next.set(id, edit);
      return next;
    });
  }, []);

  /**
   * 打开右栏概念档案：顺带记进本会话的「已浏览」集合。
   * 只有「用户主动点开」才会走到这里；落地默认选中不经过这个函数，
   * 所以阅读路径进度不会被默认选中虚高。
   */
  const openConcept = useCallback((id: string) => {
    setSelectedConceptId(id);
    setOpenedConceptIds((previous) => {
      if (previous.has(id)) return previous;
      const next = new Set(previous);
      next.add(id);
      return next;
    });
  }, []);

  /** 关闭右栏（仅小屏抽屉）：置 null，避免又回落到默认选中。 */
  const closeConcept = useCallback(() => setSelectedConceptId(null), []);

  const editCount = edits.size;
  const corpusLabel = corpus?.label ?? "本次编译产物";

  const editHeader = (concept: Concept) =>
    editing ? (
      <div style={{ marginTop: 16 }}>
        <EditBar
          allConcepts={displayConcepts}
          concept={concept}
          edit={edits.get(concept.id)}
          onApply={applyEdit}
          onMerged={(_from, into) => setSelectedConceptId(into)}
        />
      </div>
    ) : undefined;

  return (
    <div className={s.shell}>
      {/* ---------------------------------------------------------- 顶栏 */}
      <header className={s.topbar}>
        <Link className={s.brand} href={ROUTES.login}>
          <span aria-hidden className={s.brandIcon}>
            <svg viewBox="0 0 24 24">
              <line stroke="white" strokeWidth="1.5" x1="6" x2="12" y1="12" y2="7" />
              <line stroke="white" strokeWidth="1.5" x1="12" x2="18" y1="7" y2="12" />
              <line
                stroke="white"
                strokeDasharray="2 2"
                strokeWidth="1.5"
                x1="12"
                x2="13"
                y1="7"
                y2="17"
              />
              <circle cx="6" cy="12" fill="white" r="2.6" />
              <circle cx="12" cy="7" fill="white" r="2.6" />
              <circle cx="18" cy="12" fill="white" r="2.6" />
              <circle cx="13" cy="17" fill="white" r="2.2" />
            </svg>
          </span>
          <h1 className={s.topbarTitle}>Knowledge Compiler</h1>
        </Link>
        <div className={s.topbarRight}>
          <span className={s.actTag}>Act 3 · 知识空间 · {corpusLabel}</span>
          <button
            aria-pressed={editing}
            className={s.editBtn}
            onClick={() => setEditing((value) => !value)}
            type="button"
          >
            {editing ? `退出编辑${editCount ? ` · ${editCount} 处改动` : ""}` : "编辑知识空间"}
          </button>
        </div>
      </header>

      {/* -------------------------------------------------------- 作者信息条 */}
      <section className={s.authorStrip}>
        <div className={s.authorLeft}>
          <span className={s.authorName}>{dataset.creator.name}</span>
          <span className={s.authorHandle}>{dataset.creator.handle}</span>
          <span className={s.authorMeta}>
            <span>
              <b>{summary.articles}</b> 篇文章
            </span>
            <span>
              <b>{summary.concepts}</b> 个概念
            </span>
            <span>
              <b>{summary.domains}</b> 个领域
            </span>
          </span>
          <p className={s.authorBio}>{dataset.creator.bio}</p>
        </div>
        <div className={s.authorRight}>
          <span className={s.actTag} style={{ fontVariantNumeric: "tabular-nums" }}>
            {summary.conceptRelations} 条关系 · {summary.readingPaths} 条路径
          </span>
        </div>
      </section>

      {/* 二次编译状态条：仅 bayes 语料出现，其余来源（compiled / demo /
          imported / 未知）不渲染，画布也拿不到任何「新增」态。 */}
      {sourceId === RECOMPILE_DEMO_SOURCE_ID && (
        <RecompileBar
          counts={recompile.counts}
          newConceptNames={newConceptNames}
          onStart={() => {
            setPeekNew(false);
            recompile.start();
          }}
          onViewNew={() => setPeekNew((value) => !value)}
          pct={recompile.pct}
          phase={recompile.phase}
          rangeLabel={recompile.rangeLabel}
          stepIndex={recompile.stepIndex}
          viewing={peekNew}
        />
      )}

      {/* ------------------------------------------------------ 三栏工作区 */}
      <div className={s.workspace}>
        {/* 左栏：领域筛选（变暗，不隐藏）+ 阅读路径 */}
        <div className={`${s.wsCol} ${s.wsLeft}`}>
          <p className={s.colLabel}>领域筛选</p>
          <div
            className={`${s.domainRow} ${activeDomain === undefined ? s.active : ""}`}
            onClick={() => setSelectedDomain(null)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedDomain(null);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <span className={s.domainLeft}>全部领域</span>
            <span className={s.domainNum}>{displayConcepts.length}</span>
          </div>
          {groups.map(({ domain, concepts }) => {
            const active = activeDomain === domain;
            return (
              <div
                className={`${s.domainRow} ${active ? s.active : ""}`}
                key={domain}
                onClick={() => setSelectedDomain(active ? null : domain)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedDomain(active ? null : domain);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className={s.domainLeft}>
                  <i
                    aria-hidden
                    className={s.domainDot}
                    style={{ background: colors.get(domain) ?? DOMAIN_FALLBACK }}
                  />
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {domain}
                  </span>
                </span>
                <span className={s.domainNum}>{concepts.length}</span>
              </div>
            );
          })}

          <p className={`${s.colLabel} ${s.sectionGap}`}>阅读路径</p>
          {dataset.readingPaths.length ? (
            dataset.readingPaths.map((path) => {
              const total = path.conceptIds.length;
              const done = pathProgress.get(path.id) ?? 0;
              const percent = total ? Math.round((done / total) * 100) : 0;
              const browsing = selectedPathId === path.id;
              return (
                <div
                  className={s.pathItem}
                  key={path.id}
                  onClick={() => setSelectedPathId(browsing ? undefined : path.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedPathId(browsing ? undefined : path.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className={s.pathHead}>
                    <span className={s.pathTitle}>{path.title}</span>
                    <span className={s.pathLevel}>{PATH_LEVEL_LABELS[path.level]}</span>
                  </div>
                  <p className={s.pathSummary}>{path.summary}</p>
                  <div className={s.pathMeta}>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {total} 个概念
                    </span>
                    <span className={s.pathGo}>{browsing ? "退出 ✕" : "→"}</span>
                  </div>
                  <div className={s.pathProgress}>
                    <i className={s.pathProgressBar} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })
          ) : (
            <p className={s.pathSummary}>这份产物还没有生成阅读路径。</p>
          )}
        </div>

        {/* 中栏：图谱画布 */}
        <div className={`${s.wsCol} ${s.canvasCol}`}>
          <GraphCanvas
            compiling={recompileRunning}
            data={playbackGraph}
            dimmedDomains={dimmedDomains}
            focusNew={focusNew}
            highlightedNodeIds={highlightedIds}
            newEdgeIds={revealNew ? recompile.newEdgeIds : undefined}
            newNodeIds={revealNew ? recompile.newNodeIds : undefined}
            onNodeSelect={openConcept}
            // 知识演变回放落在画布左下角（参考稿 .evo-fab 就在 .stage 内部），
            // 因此走 overlay 挂进 stage，而不是固定到浏览器视口。
            overlay={
              <TimelinePlayer
                cursor={cursor}
                dataset={dataset}
                onChange={onTimelineChange}
                setCursor={setCursor}
              />
            }
            selectedNodeId={effectiveSelectedId}
            updatedNodeIds={revealNew ? recompile.updatedNodeIds : undefined}
          />
        </div>

        {/* 右栏：概念档案。参考稿 ws-right 之后直接是 ins-breadcrumb，
            栏目标签只出现在左栏（领域 / 阅读路径），这里不设栏目标签。 */}
        <div className={`${s.wsCol} ${s.wsRight}`}>
          {selected ? (
            <ConceptCard
              concept={selected}
              dataset={graphDataset}
              headerSlot={editHeader(selected)}
              onSelectConcept={openConcept}
            />
          ) : (
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
              点击画布中的一个概念查看它的档案：观点演变、关系网络与原文证据。
            </p>
          )}
        </div>
      </div>

      {/* --------------------------------------------------- 小屏概念抽屉 */}
      {selected && (
        <div className={s.drawer}>
          <div
            aria-hidden
            className={s.drawerScrim}
            onClick={() => closeConcept()}
          />
          <div className={s.drawerPanel}>
            <ConceptCard
              concept={selected}
              dataset={graphDataset}
              headerSlot={editHeader(selected)}
              onSelectConcept={openConcept}
            />
          </div>
        </div>
      )}
    </div>
  );
}
