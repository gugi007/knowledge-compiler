"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ROUTES } from "@/lib/frontend/routes";
import { useCompile } from "@/app/_shared/hooks/use-compile";
import { summarize } from "@/lib/frontend/dataset";
import { COMPILED_SOURCE_ID } from "@/lib/frontend/handoff";
import { STAGE_TO_PRODUCT, type ProductStage } from "@/lib/frontend/compile-stream";
import { isCorpusId, type CorpusId } from "@/lib/frontend/corpora";
import styles from "./compile.module.css";
import { COMPILE_STEP_LABELS } from "./stage-presenters";
import {
  CompileProgress,
  LiveStats,
  type ActivityEntry,
} from "./stage-panels";
import { useCompileRhythm, type CompileRhythm } from "./progress-rhythm";
import { ReviewPanel } from "./review-panel";

/**
 * 第二幕：编译台。
 *
 * OWNER: compiler-ui-agent（本目录下所有内容）
 *
 * 知乎风重造（参考稿 compiler.html）：
 * - 顶栏本地渲染，停用共享 PageShell / StatGrid（仅不再 import，共享文件未动，
 *   待知会 architect：若其它幕也弃用可考虑下线共享组件）。
 * - 按 compile.status 分两个视图：idle|running|error → 编译中；done → 完成。
 * - 「最近活动」日志由客户端按收到的 stage / complete 事件合成（本地 HH:MM +
 *   阶段文案），严禁伪造逐篇进度——服务器只发 5 个 stage 事件。
 * - 编译耗时由客户端计时（start() 时刻 → status 变 done），自适应秒/分。
 * - 全部数据来自 useCompile / dataset / summarize，无硬编码演示数字。
 */

const tick = () => 0;

/** useCompile 的返回类型（共享 hook 未导出具名类型，用 ReturnType 取）。 */
type CompileApi = ReturnType<typeof useCompile>;

/**
 * 读取地址栏 ?corpus= 并收窄成合法 CorpusId；非法/缺省 → undefined → useCompile 退回 "demo"。
 * 合法取值以 lib/frontend/corpora.ts 的 `CorpusId` / `isCorpusId` 为唯一事实来源，
 * 此处不再抄一份 id 清单（抄了就会随契约漂移静默漏改）。
 * 语义备忘：内置语料为 demo（LLM 综述样例）与 bayes（概率论与统计推断，
 * 作者「沈亦舟 @bayes-lab」，取代早先的苏剑林语料）。
 * 用 useSyncExternalStore + window.location（不用 useSearchParams，免静态渲染套 Suspense）。
 */
function useCorpusParam(): CorpusId | undefined {
  const search = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("popstate", onChange);
      return () => window.removeEventListener("popstate", onChange);
    },
    () => window.location.search,
    () => "",
  );
  const param = new URLSearchParams(search).get("corpus") ?? "";
  return isCorpusId(param) ? param : undefined;
}

/** 本地 HH:MM 时间戳（活动日志用）。 */
function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** 编译耗时自适应文案：<90s 用秒，否则四舍五入到分钟。 */
function formatElapsed(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds} 秒`;
  return `${Math.round(seconds / 60)} 分钟`;
}

export function CompileWorkspace() {
  const corpus = useCorpusParam();
  const compile = useCompile({ corpus, mode: "compile" });
  const { start, reset } = compile;

  // 展示进度节奏：百分比 / Stepper / 状态文案 / 完成态的**唯一**来源。
  // 不收尾完成（补间 + 1.5s 停留）不切结果页，见下面的视图条件。
  const rhythm = useCompileRhythm({
    status: compile.status,
    productStage: compile.productStage,
  });

  // ---- 活动日志（客户端按 stage/complete 事件合成，不伪造逐篇进度） ----
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const loggedRef = useRef<{
    started: Set<ProductStage>;
    completed: Set<ProductStage>;
    done: boolean;
    error: boolean;
  }>({ started: new Set(), completed: new Set(), done: false, error: false });

  // ---- 编译耗时计时（start → done） ----
  const startedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  // 「再编译一次」：reset() 后 start() 的守卫（status==="done" 直接 return）
  // 还看着旧闭包，需要等 status 回到 idle 再点火。
  const pendingRecompileRef = useRef(false);

  const handleStart = () => {
    // 展示进度归零必须与 stream 起点同拍：否则再编译时会从上一轮的 100% 起跳。
    rhythm.reset();
    startedAtRef.current = Date.now();
    setElapsedMs(null);
    setActivity([]);
    loggedRef.current = {
      started: new Set(),
      completed: new Set(),
      done: false,
      error: false,
    };
    start();
  };

  const handleRecompile = () => {
    pendingRecompileRef.current = true;
    // 同一个事件里把展示进度也归零，与 compile.reset() 一起批处理：
    // 否则 status 回 idle 的那一帧会以上一轮的 100% 渲染 CompilingView。
    rhythm.reset();
    reset();
  };

  // reset 落地（status 回到 idle）后自动点火再编译
  useEffect(() => {
    if (pendingRecompileRef.current && compile.status === "idle") {
      pendingRecompileRef.current = false;
      handleStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compile.status]);

  // 按收到的事件追加日志：先记完成、再记新阶段开始（同帧事件保持时序）
  useEffect(() => {
    if (compile.status === "idle") return;
    const logged = loggedRef.current;
    const now = formatClock(new Date());
    setActivity((prev) => {
      const next = [...prev];
      for (const finished of compile.completedStages) {
        const stage = STAGE_TO_PRODUCT[finished];
        if (!logged.completed.has(stage)) {
          logged.completed.add(stage);
          next.push({ time: now, text: `${COMPILE_STEP_LABELS[stage]}完成` });
        }
      }
      const current = compile.productStage;
      if (
        compile.status === "running" &&
        current &&
        !logged.started.has(current)
      ) {
        logged.started.add(current);
        next.push({
          time: now,
          text: `开始${COMPILE_STEP_LABELS[current]}`,
        });
      }
      if (compile.status === "done" && !logged.done) {
        logged.done = true;
        next.push({ time: now, text: "知识网络编译完成" });
      }
      if (compile.status === "error" && !logged.error) {
        logged.error = true;
        next.push({ time: now, text: "编译中断" });
      }
      return next;
    });
    if (compile.status === "done" && startedAtRef.current != null) {
      setElapsedMs(Date.now() - startedAtRef.current);
      startedAtRef.current = null;
    }
  }, [compile.status, compile.productStage, compile.completedStages]);

  return (
    <div className={styles.root}>
      <CompileTopbar />
      <main className={styles.main}>
        <div className={`${styles.container} ${styles.mainInner}`}>
          {compile.status === "done" && compile.dataset && rhythm.done ? (
            <DoneView
              compile={compile}
              elapsedMs={elapsedMs}
              onRecompile={handleRecompile}
            />
          ) : (
            <CompilingView
              compile={compile}
              corpus={corpus}
              activity={activity}
              rhythm={rhythm}
              onStart={handleStart}
              onReset={reset}
            />
          )}
        </div>
      </main>
    </div>
  );
}

/* ---------- 本地顶栏（两视图共用） ---------- */

function CompileTopbar() {
  return (
    <header className={styles.topbar}>
      <div className={`${styles.container} ${styles.topbarInner}`}>
        <div className={styles.topbarLeft}>
          {/* 品牌锁扣即返回入口（原「← 返回」链接已删，不留其占位）。 */}
          <Link className={styles.brandLockup} href={ROUTES.login}>
            <div className={styles.brandIcon}>
              <svg aria-hidden viewBox="0 0 24 24">
                <line stroke="white" strokeWidth="1.5" x1="6" x2="12" y1="12" y2="7" />
                <line stroke="white" strokeWidth="1.5" x1="12" x2="18" y1="7" y2="12" />
                <line stroke="white" strokeDasharray="2 2" strokeWidth="1.5" x1="12" x2="13" y1="7" y2="17" />
                <circle cx="6" cy="12" fill="white" r="2.6" />
                <circle cx="12" cy="7" fill="white" r="2.6" />
                <circle cx="18" cy="12" fill="white" r="2.6" />
                <circle cx="13" cy="17" fill="white" r="2.2" />
              </svg>
            </div>
            <div className={styles.brand}>Knowledge Compiler</div>
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ---------- 视图 A：编译中（idle | running | error） ---------- */

function CompilingView({
  compile,
  corpus,
  activity,
  rhythm,
  onStart,
  onReset,
}: {
  compile: CompileApi;
  corpus: CorpusId | undefined;
  activity: ActivityEntry[];
  rhythm: CompileRhythm;
  onStart: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <div className={styles.compileHead}>
        <div className={styles.eyebrow}>Compiler</div>
        <h1 className={styles.compileTitle}>编译你的创作史</h1>
        <p className={styles.compileSub}>
          把按时间散落的文章，编译成一张可探索的知识网络。
        </p>
      </div>

      <div className={`${styles.panel} ${styles.compileGrid}`}>
        <div className={styles.compileLeft}>
          <CompileProgress rhythm={rhythm} />

          {compile.status === "idle" && (
            <>
              <p className={styles.idleNote}>
                流水线会读取全部创作、抽取概念并建立关系，最后生成可探索的知识网络与阅读路径。编译过程约一分钟，期间请保持页面打开。
              </p>
              <div className={styles.startRow}>
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={onStart}
                  type="button"
                >
                  开始编译
                </button>
              </div>
            </>
          )}

          {compile.status === "error" && (
            <div className={styles.errorBox} role="alert">
              <p className={styles.errorText}>{compile.error}</p>
              <div className={styles.errorActions}>
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={onStart}
                  type="button"
                >
                  重试
                </button>
                <Link
                  className={styles.btn}
                  href={ROUTES.login}
                  onClick={() => onReset()}
                >
                  重新来过
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className={styles.compileRight}>
          <LiveStats compile={compile} activity={activity} />
        </div>
      </div>

      {/* 参考稿此处的左侧按钮是「查看演示结果 →」；真实流程里编译未完成
          没有结果可看（后端限制），故省略，只保留贴右的 foot-meta。 */}
      <div className={`${styles.bottombar} ${styles.bottombarEnd}`}>
        <span className={styles.footMeta}>
          {compile.status === "running" && "编译中 · 不要关闭页面"}
          {compile.status === "idle" && "未开始 · 语料就绪后可开始编译"}
          {compile.status === "error" && "编译中断 · 可重试或重新来过"}
          {/* done：收尾（补间 + 停留）期间视图仍是编译中，底栏不能空 */}
          {compile.status === "done" && "编译完成 · 结果已保存"}
        </span>
      </div>
      {/* 语料口径说明：imported 语料来自知乎创作摘要（约 200–320 字），并非正文全文 */}
      <div className={styles.demoLine}>
        {corpus === "imported"
          ? "当前语料为你的知乎创作摘要，非正文全文"
          : "演示模式 · 当前使用内置示例语料"}
      </div>
    </>
  );
}

/* ---------- 视图 B：编译完成（done） ---------- */

function DoneView({
  compile,
  elapsedMs,
  onRecompile,
}: {
  compile: CompileApi;
  elapsedMs: number | null;
  onRecompile: () => void;
}) {
  const dataset = compile.dataset!;
  const s = summarize(dataset);

  return (
    <>
      <div className={styles.hero}>
        <div className={styles.heroLeft}>
          <span className={styles.doneBadge}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          <div>
            <h1 className={styles.heroTitle}>编译完成</h1>
            <p className={styles.heroSub}>
              {s.articles} 篇创作 · {s.concepts} 个概念 · {s.conceptRelations}{" "}
              条关系 · {s.readingPaths} 条阅读路径
            </p>
          </div>
        </div>
        <div className={styles.heroActions}>
          <button className={styles.btn} onClick={onRecompile} type="button">
            再编译一次
          </button>
          <Link
            className={`${styles.btn} ${styles.btnPrimary}`}
            href={`${ROUTES.space}?source=${COMPILED_SOURCE_ID}`}
          >
            进入我的知识空间
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statNum}>{s.articles}</span>
          <span className={styles.statLbl}>创作</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{s.concepts}</span>
          <span className={styles.statLbl}>概念</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{s.conceptRelations}</span>
          <span className={styles.statLbl}>关系</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{s.readingPaths}</span>
          <span className={styles.statLbl}>阅读路径</span>
        </div>
      </div>

      <ReviewPanel dataset={dataset} />

      <div className={styles.bottombar}>
        <button
          className={styles.btn}
          onClick={onRecompile}
          type="button"
        >
          ← 回到编译过程
        </button>
        <span className={styles.footMeta}>
          {elapsedMs != null
            ? `编译耗时 ${formatElapsed(elapsedMs)} · 结果已保存`
            : "结果已保存"}
        </span>
      </div>
    </>
  );
}

void tick;
