"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
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
import { LatexText } from "./latex-text";
import { absorbedInto, EditBar, type ConceptEdit, type EditMap } from "./edit-mode";
import { domainColorMap, domainOrderOf, DOMAIN_FALLBACK } from "./graph/_lib/domain-colors";
import { GraphCanvas } from "./graph/graph-canvas";
import { RecompileBar } from "./recompile-bar";
import {
  baselineRawSnapshot,
  baselineServerSnapshot,
  buildRecompileSelection,
  parseBaseline,
  useRecompileDemo,
} from "./recompile-demo-data";
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

/**
 * 基线 store 的订阅：这个 store 在组件生命周期内不会变（语料切换走整页导航），
 * 所以订阅是空实现——同 app/_shared/hooks/use-active-dataset.ts 的 noopSubscribe。
 */
const noopSubscribe = () => () => {};

/** 未在浏览任何路径时的「已走过」集合。稳定引用，免得每次退出都换一个新 Set。 */
const EMPTY_CONCEPT_IDS: ReadonlySet<string> = new Set();

export function SpaceView() {
  const { dataset, sourceId } = useActiveDataset();
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
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<EditMap>(new Map());
  const [cursor, setCursor] = useState(-1);
  const [timeline, setTimeline] = useState<TimelineState>();
  /**
   * **本次路径浏览**中打开过的概念 id（仅内存，不做持久化）。
   *
   * 语义是「本次浏览」而不是「本会话」：进入路径时重置、退出时清空，否则进度条
   * 只会增不会减，退出后仍停在旧读数。跨路径累计的信息是有意不要的。
   */
  const [pathVisitedIds, setPathVisitedIds] = useState<ReadonlySet<string>>(() => new Set());
  /** done 态点「查看新增」后的聚焦态（纯前端演示，不落盘）。 */
  const [peekNew, setPeekNew] = useState(false);
  /**
   * 状态条的会话内**锁存**：一旦用户点过「二次编译」，这条就一直渲染到本次
   * 会话结束（刷新归零）。
   *
   * 为什么需要：编译完成的那一刻会把基线写回，检测门随之算出「没有新文章」。
   * 没有锁存的话，状态条会在完成态渲染的同一帧被卸载，用户看不到完成态，
   * 也点不到「查看新增」。只增不减，只在事件回调里设（不在 effect 里同步 setState）。
   */
  const [barLatched, setBarLatched] = useState(false);
  /**
   * done 态点「收起」后的整条 dismiss。必须提在这里（而不是收在 RecompileBar
   * 内部）：收起要连带清掉画布上的新增高亮，所以 revealNew / focusNew / compiling
   * 都得看得见它。只清视觉，不动任何统计数字、不动 dataset。
   */
  const [barDismissed, setBarDismissed] = useState(false);

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
  const revealNew =
    !barDismissed && !recompileIdle && (recompile.phase === "done" || recompile.stepIndex >= 2);
  /**
   * 基线快照：读 localStorage 用 useSyncExternalStore + 原始字符串快照（同
   * use-active-dataset 的做法）。两处消费——下面的 mergedDelta 取合入规模，
   * 以及 hasNews 检测门判「这份知识有没有合入过」。
   *
   * 声明必须排在 mergedDelta 之前：useMemo 的工厂函数在渲染期就求值，
   * 晚声明会踩到 `const` 的暂时性死区。
   */
  const baselineRaw = useSyncExternalStore(
    noopSubscribe,
    baselineRawSnapshot,
    baselineServerSnapshot,
  );
  /**
   * 作者条要叠加的合入量，两级取值：
   *
   * 1. 本会话刚跑完（phase === "done" 且这次真的有新增文章）→ 用本次的 counts；
   * 2. 否则若基线里存着上次跑完落盘的 delta → 用它。刷新后 phase 回到 idle，
   *    合入量的唯一来源就是这里，作者条的读数因此不会掉回真实值；
   * 3. 都没有（首次访问 / `?reset=1` 把基线快照压成 null）→ 全 0，显示真实值。
   *
   * 与画布高亮的 revealNew **无关**：收起状态条照旧清掉新增高亮，统计数字照样保留。
   */
  const mergedDelta = useMemo(() => {
    const live =
      recompile.phase === "done" && recompile.counts.articles > 0 ? recompile.counts : undefined;
    const merged = live ?? parseBaseline(baselineRaw)?.delta;
    if (!merged) return { articles: 0, concepts: 0, relations: 0 };
    return {
      articles: merged.articles,
      concepts: merged.concepts,
      relations: merged.relations,
    };
  }, [recompile.phase, recompile.counts, baselineRaw]);
  /**
   * 聚焦新增只留给「跑完之后用户主动点查看新增」。
   *
   * 运行期不再叠 focusNew：`.stage.compiling`（非新增压到 .5）与 `.stage.focusNew`
   * （压到 .18）在 CSS 里同优先级、后写的 focusNew 胜出，两者同时命中时实际生效的是
   * .18 —— 编译到第 3 步就变成了「查看新增」的观感。
   *
   * 新节点的浮现不依赖这里：画布用 newNodeIds 判定 isNew（graph-canvas 里
   * `newNodes.has(node.id) || highlighted.has(node.id)`），再挂 `.newNode .on`；
   * CSS 的两条氛围态规则都带 `:not(.newNode)`，压根压不到新节点。
   *
   * revealNew 里已经折进了 !barDismissed，所以「收起」会一并清掉聚焦。
   */
  const focusNew = revealNew && peekNew;
  /**
   * 检测门：有基线且文章差集为空 → 这份知识已经合入过，本次没有新增 → 状态条静默。
   * 基线快照（baselineRaw）已在上面声明，这里只做差集判定。
   */
  // 数据集很小（bayes 17 篇 / 17 概念），直接算，不做额外缓存。
  const hasNews = useMemo(
    () => buildRecompileSelection(dataset, parseBaseline(baselineRaw)).newArticleIds.length > 0,
    [dataset, baselineRaw],
  );
  /** 状态条是否渲染：仅 bayes / 未收起 / （真的有新文章 或 本会话锁存过）。 */
  const showBar =
    sourceId === RECOMPILE_DEMO_SOURCE_ID && !barDismissed && (barLatched || hasNews);
  const newConceptNames = useMemo(() => {
    if (!recompile.newNodeIds.length) return [];
    const index = new Map(dataset.concepts.map((concept) => [concept.id, concept.name]));
    return recompile.newNodeIds
      .map((id) => index.get(id))
      .filter((name): name is string => Boolean(name));
  }, [dataset.concepts, recompile.newNodeIds]);

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
   * 正在浏览的阅读路径：左栏的「退出 ✕」与画布航线共用这一个来源，
   * 两处各算一遍迟早会分叉。`conceptIds` 的数组顺序就是路径本身，画布照序连线。
   */
  const selectedPath = useMemo(() => {
    if (!selectedPathId) return undefined;
    return dataset.readingPaths.find((path) => path.id === selectedPathId);
  }, [dataset.readingPaths, selectedPathId]);

  /**
   * 本次浏览沿路径走过的概念数。未在浏览时恒为 0——这正是「退出归零」的落点。
   * 定义必须排在 selectedPath 之后（依赖它），消费点在左栏进度条。
   */
  const browsingDone = useMemo(() => {
    if (!selectedPath) return 0;
    return selectedPath.conceptIds.filter((id) => pathVisitedIds.has(id)).length;
  }, [selectedPath, pathVisitedIds]);

  /**
   * 打开右栏概念档案：无条件记进「本次浏览」集合，记的是**原始 id**。
   *
   * 与路径概念的求交不在这里做，而在 browsingDone 里——只有「正在浏览的那条路径」
   * 会被读取，所以非浏览期间累积的 id 无害（它读不到），进入路径时会整体重置。
   * 只有「用户主动点开」才走这里；落地默认选中不经过它，进度不会被默认选中虚高。
   */
  const openConcept = useCallback((id: string) => {
    setSelectedConceptId(id);
    setSelectedEdgeId(undefined);
    setPathVisitedIds((previous) => {
      if (previous.has(id)) return previous;
      const next = new Set(previous);
      next.add(id);
      return next;
    });
  }, []);

  /** 关闭右栏（仅小屏抽屉）：置 null，避免又回落到默认选中。 */
  const closeConcept = useCallback(() => setSelectedConceptId(null), []);

  /**
   * 进入阅读路径时把右栏切到路径的第一个概念；返回它是否真的被打开，
   * 调用方据此决定进度从 1/N 还是 0/N 起。
   *
   * 存在性保护是必须的：`path.conceptIds` 来自原始 dataset，不跟着编辑走，而右栏
   * 读的是 displayConcepts——首概念可能已被删除或被并入它物。openConcept 的调用方
   * 契约要求 id 可查，否则右栏会选中一个不存在的概念（空白档案、点不出关系）。
   */
  const openPathStart = useCallback(
    (conceptId: string | undefined): boolean => {
      if (!conceptId || !displayConcepts.some((concept) => concept.id === conceptId)) return false;
      openConcept(conceptId);
      return true;
    },
    [displayConcepts, openConcept],
  );

  const editCount = edits.size;

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
              <b>{summary.articles + mergedDelta.articles}</b> 篇文章
            </span>
            <span>
              <b>{summary.concepts + mergedDelta.concepts}</b> 个概念
            </span>
            <span>
              <b>{summary.domains}</b> 个领域
            </span>
          </span>
          <p className={s.authorBio}>{dataset.creator.bio}</p>
        </div>
        <div className={s.authorRight}>
          <span className={s.actTag} style={{ fontVariantNumeric: "tabular-nums" }}>
            {summary.conceptRelations + mergedDelta.relations} 条关系 · {summary.readingPaths} 条路径
          </span>
        </div>
      </section>

      {/* 二次编译状态条：仅 bayes 语料出现，其余来源（compiled / demo /
          imported / 未知）不渲染，画布也拿不到任何「新增」态。
          出现条件 = 未收起 &&（「真的有新文章」——有基线且差集为空时静默——
          或「本会话锁存」——编译完成会把基线写回，门随即变假，靠锁存留住完成态）。 */}
      {showBar && (
        <RecompileBar
          counts={recompile.counts}
          newConceptNames={newConceptNames}
          onDismiss={() => {
            setPeekNew(false);
            setBarDismissed(true);
          }}
          onStart={() => {
            setPeekNew(false);
            setBarLatched(true);
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
              const browsing = selectedPath?.id === path.id;
              // 进和出必须都动「已走过」集合，否则同一条进度在进/出两个方向上
              // 影响相反，退出后停在旧读数。
              const done = browsing ? browsingDone : 0;
              const percent = total ? Math.round((done / total) * 100) : 0;
              /** 进入/退出浏览。进入时右栏落到首概念，退出不清右栏。 */
              const toggle = () => {
                if (browsing) {
                  setSelectedPathId(undefined);
                  setPathVisitedIds(EMPTY_CONCEPT_IDS);
                  return;
                }
                const first = path.conceptIds[0];
                setSelectedPathId(path.id);
                // 首概念确实被打开时进度从 1/N 起（与「打开概念就计数」同一条规则），
                // 而不是 0/N 显示着 0 却已经在看第一个概念。
                // openPathStart 内部也会写这个集合，所以必须排在它之后调用：
                // 批处理里后一次覆盖前一次，seed 生效（seed 本就含 first，等价）。
                setPathVisitedIds(
                  openPathStart(first) && first ? new Set([first]) : EMPTY_CONCEPT_IDS,
                );
              };
              return (
                <div
                  className={s.pathItem}
                  key={path.id}
                  onClick={toggle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className={s.pathHead}>
                    <span className={s.pathTitle}>{path.title}</span>
                    <span className={s.pathLevel}>{PATH_LEVEL_LABELS[path.level]}</span>
                  </div>
                  <p className={s.pathSummary}>
                    <LatexText>{path.summary}</LatexText>
                  </p>
                  <div className={s.pathMeta}>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {total} 个概念
                    </span>
                    <span className={s.pathGo}>{browsing ? "退出 ✕" : "→"}</span>
                  </div>
                  <div className={s.pathProgress}>
                    <i className={s.pathProgressBar} style={{ width: `${percent}%` }} />
                  </div>
                  {browsing && (
                    <ol className={s.pathSteps}>
                      {path.conceptIds.map((cid, idx) => {
                        const concept = displayConcepts.find((item) => item.id === cid);
                        const isCurrent = cid === effectiveSelectedId;
                        return (
                          <li key={cid}>
                            <button
                              className={`${s.pathStepBtn} ${isCurrent ? s.pathStepBtnOn : ""}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                // cid 来自原始 dataset，可能已被编辑删除/合并；
                                // 这种步骤按钮不动作，避免右栏切到一个不存在的概念。
                                if (concept) openConcept(cid);
                              }}
                              type="button"
                            >
                              <span
                                className={`${s.pathStepNo} ${isCurrent ? s.pathStepNoOn : ""}`}
                              >
                                {idx + 1}
                              </span>
                              <span className={s.pathStepName}>
                                {concept?.name ?? cid}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
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
            compiling={recompileRunning && !barDismissed}
            data={playbackGraph}
            dimmedDomains={dimmedDomains}
            focusNew={focusNew}
            highlightedNodeIds={highlightedIds}
            newEdgeIds={revealNew ? recompile.newEdgeIds : undefined}
            newNodeIds={revealNew ? recompile.newNodeIds : undefined}
            onEdgeSelect={setSelectedEdgeId}
            onNodeSelect={openConcept}
            pathNodeIds={selectedPath?.conceptIds}
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
            selectedEdgeId={selectedEdgeId}
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
              onSelectEdge={setSelectedEdgeId}
              selectedEdgeId={selectedEdgeId}
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
              onSelectEdge={setSelectedEdgeId}
              selectedEdgeId={selectedEdgeId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
