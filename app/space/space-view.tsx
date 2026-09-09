"use client";

import { useMemo, useState } from "react";
import { useActiveDataset } from "@/app/_shared/hooks/use-active-dataset";
import { PageShell } from "@/app/_shared/ui/page-shell";
import { ScaffoldNotice } from "@/app/_shared/ui/scaffold-notice";
import { StatGrid } from "@/app/_shared/ui/stat-grid";
import {
  backlinksOf,
  buildGraphData,
  conceptsByDomain,
  neighborsOf,
  summarize,
} from "@/lib/frontend/dataset";
import { GraphCanvas } from "./graph/graph-canvas";

/**
 * 第三幕：知识空间骨架。
 *
 * OWNER: knowledge-space-agent
 *
 * 现在只证明数据链路是通的：内置语料或编译产物 → 投影层 → 画布契约。
 * 左栏领域筛选、画布、概念详情三块都在位，但都是最简形态。
 * 时间轴回放、编辑模式、增量高亮尚未做。
 *
 * 契约边界：只从 lib/frontend/dataset.ts 取数，不要自己遍历 dataset.relations——
 * 关系方向与 article-concept 过滤的口径集中在投影层，各自实现会分叉。
 */
export function SpaceView() {
  const { dataset, corpus, resolved } = useActiveDataset();
  const [selectedDomain, setSelectedDomain] = useState<string>();
  const [selectedConceptId, setSelectedConceptId] = useState<string>();

  const summary = useMemo(() => summarize(dataset), [dataset]);
  const groups = useMemo(() => conceptsByDomain(dataset), [dataset]);
  const graph = useMemo(() => buildGraphData(dataset), [dataset]);

  const selected = selectedConceptId
    ? dataset.concepts.find(({ id }) => id === selectedConceptId)
    : undefined;
  const neighbors = selected ? neighborsOf(dataset, selected.id) : [];
  const backlinks = selected ? backlinksOf(dataset, selected.id) : [];

  return (
    <PageShell eyebrow="Act 3 · 知识空间">
      {/* 作者头：署名 + 规模。 */}
      <section className="panel mt-6 p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold">{dataset.creator.name}</h1>
            <p className="mt-1 text-sm text-ink/55">
              {dataset.creator.handle} · {corpus?.label ?? "本次编译产物"}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink/60">{dataset.creator.bio}</p>
          </div>
          <span className="flex items-center gap-2 text-[11px] font-bold text-ink/45">
            <span className="status-dot" aria-hidden />
            {resolved ? "生长中" : "载入中"}
          </span>
        </div>
        <div className="mt-5">
          <StatGrid
            items={[
              { label: "Articles", value: summary.articles },
              { label: "Concepts", value: summary.concepts },
              { label: "Relations", value: summary.conceptRelations },
              { label: "Domains", value: summary.domains },
            ]}
          />
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr_260px]">
        {/* 左栏：领域筛选（星区）+ 阅读路径（航线）。 */}
        <aside className="panel p-4">
          <p className="eyebrow">领域</p>
          <div className="mt-3 grid gap-1">
            <button
              className={`concept-link ${selectedDomain === undefined ? "concept-link-active" : ""}`}
              onClick={() => setSelectedDomain(undefined)}
              type="button"
            >
              全部
              <span className="font-mono text-[10px]">{summary.concepts}</span>
            </button>
            {groups.map(({ domain, concepts }) => (
              <button
                className={`concept-link ${selectedDomain === domain ? "concept-link-active" : ""}`}
                key={domain}
                onClick={() => setSelectedDomain(domain)}
                type="button"
              >
                {domain}
                <span className="font-mono text-[10px]">{concepts.length}</span>
              </button>
            ))}
          </div>

          <p className="eyebrow mt-6">阅读路径</p>
          <ul className="mt-3 grid gap-1.5">
            {dataset.readingPaths.map((path) => (
              <li className="text-xs leading-5 text-ink/60" key={path.id}>
                {path.title}
                <span className="ml-1 font-mono text-[10px] text-ink/35">
                  {path.conceptIds.length}
                </span>
              </li>
            ))}
          </ul>
        </aside>

        {/* 画布：内部实现归 app/space/graph/**。 */}
        <section>
          <GraphCanvas
            data={graph}
            onNodeSelect={setSelectedConceptId}
            selectedNodeId={selectedConceptId}
            visibleDomains={selectedDomain ? [selectedDomain] : undefined}
          />
        </section>

        {/* 右栏：概念档案卡。 */}
        <aside className="panel p-4">
          <p className="eyebrow">概念档案</p>
          {selected ? (
            <div className="mt-3">
              <h2 className="font-display text-lg font-semibold">{selected.name}</h2>
              <p className="mt-1 font-mono text-[10px] text-ink/40">
                {selected.domain} · {selected.level}
              </p>
              <p className="mt-2 text-xs leading-5 text-ink/60">{selected.summary}</p>
              <p className="mt-3 font-mono text-[10px] text-ink/40">
                {neighbors.length} 条关系 · {backlinks.length} 篇回链
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs leading-5 text-ink/45">点击一个概念查看它的档案。</p>
          )}
        </aside>
      </div>

      <ScaffoldNotice
        owner="knowledge-space-agent"
        todo={[
          "图谱画布实现与技术选型（星区聚类、桥梁、缩放平移）",
          "概念档案卡：观点演变时间线、原文证据句、编辑动作",
          "点开关系边看证据引文",
          "底部时间轴：拖动回放知识生长过程",
          "编辑模式开关：合并 / 重命名 / 确认 / 修正 / 删除",
          "增量编译后的新增节点高亮",
          "响应式：窄屏隐藏左右栏，档案卡改抽屉",
        ]}
      />
    </PageShell>
  );
}
