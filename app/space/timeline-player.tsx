"use client";

import { useEffect, useMemo } from "react";
import type { CompiledKnowledgeDataset } from "@/data/models";
import { articlesByDate, conceptIndex } from "@/lib/frontend/dataset";

/**
 * 底部时间轴：回放知识生长过程。
 *
 * OWNER: knowledge-space-agent
 *
 * 口径：一篇文章「带来」一个概念，当且仅当该概念把它列进 evidenceArticleIds，
 * 或存在 article-concept 关系指向它（两边都可能各自缺项，因此取并集）。
 * 文章按发布时间升序，游标走到第 N 篇 = 前 N 篇带来的概念都已「长出」。
 *
 * 输出给父级：
 * - revealedIds：游标之前（含）已出现的概念，用于画布灰显未来节点
 * - freshIds：仅当前这一篇新带来的概念，用于高亮
 */

export interface TimelineState {
  /** 游标位置：-1 表示还没开始（等价于 0），articleCount 表示走完。 */
  cursor: number;
  total: number;
  /** 游标之前（含）已出现的概念 id。 */
  revealedIds: string[];
  /** 仅当前游标这一篇新带来的概念 id。 */
  freshIds: string[];
  /** 当前游标所指文章；cursor < 0 时为 undefined。 */
  currentArticleTitle?: string;
  currentArticleDate?: string;
}

interface Props {
  dataset: CompiledKnowledgeDataset;
  onChange: (state: TimelineState) => void;
  /** 由父级持有，便于与其他控件联动（如编辑模式关闭时复位）。 */
  cursor: number;
  setCursor: (cursor: number) => void;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short" }).format(
    new Date(date),
  );
}

export function TimelinePlayer({ dataset, onChange, cursor, setCursor }: Props) {
  const articles = useMemo(() => articlesByDate(dataset), [dataset]);
  const concepts = useMemo(() => conceptIndex(dataset), [dataset]);

  // articleId → 它带来的概念 id 集合（并集口径）。
  const conceptsByArticle = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (articleId: string, conceptId: string) => {
      let bucket = map.get(articleId);
      if (!bucket) {
        bucket = new Set();
        map.set(articleId, bucket);
      }
      bucket.add(conceptId);
    };
    for (const concept of dataset.concepts) {
      for (const articleId of concept.evidenceArticleIds) add(articleId, concept.id);
    }
    for (const relation of dataset.relations) {
      if (relation.kind !== "article-concept") continue;
      // article-concept 的方向是 article → concept。
      add(relation.sourceId, relation.targetId);
    }
    return map;
  }, [dataset]);

  const state = useMemo<TimelineState>(() => {
    const revealed = new Set<string>();
    for (let index = 0; index <= cursor && index < articles.length; index += 1) {
      for (const id of conceptsByArticle.get(articles[index]!.id) ?? []) revealed.add(id);
    }
    const fresh = new Set<string>();
    if (cursor >= 0 && cursor < articles.length) {
      for (const id of conceptsByArticle.get(articles[cursor]!.id) ?? []) fresh.add(id);
    }
    const current = cursor >= 0 ? articles[cursor] : undefined;
    return {
      cursor,
      total: articles.length,
      revealedIds: [...revealed].filter((id) => concepts.has(id)),
      freshIds: [...fresh].filter((id) => concepts.has(id)),
      currentArticleTitle: current?.title,
      currentArticleDate: current ? formatDate(current.publishedAt) : undefined,
    };
  }, [articles, concepts, conceptsByArticle, cursor]);

  // 派生状态经 effect 上抛，避免在渲染期调用父级 setState。
  useEffect(() => {
    onChange(state);
  }, [onChange, state]);

  const playing = cursor >= 0;

  return (
    <section className="panel mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
              playing
                ? "border border-ink/15 text-ink/60 hover:border-coral hover:text-coral"
                : "bg-coral text-white hover:bg-[#004bbb]"
            }`}
            onClick={() => setCursor(playing ? -1 : 0)}
            type="button"
          >
            {playing ? "退出回放" : "▶ 回放生长"}
          </button>
          {playing && (
            <p className="min-w-0 text-xs text-ink/55">
              <span className="font-mono text-[10px] text-ink/40">
                {state.currentArticleDate} · {cursor + 1}/{state.total}
              </span>
              <span className="mx-2 text-ink/20">|</span>
              <span className="font-bold">{state.currentArticleTitle}</span>
            </p>
          )}
        </div>
        {playing && (
          <p className="font-mono text-[10px] text-ink/40">
            已出现 {state.revealedIds.length} 概念 · 本篇新增 {state.freshIds.length}
          </p>
        )}
      </div>

      {playing && (
        <input
          aria-label="时间轴游标"
          className="mt-3 w-full accent-coral"
          max={articles.length - 1}
          min={0}
          onChange={(event) => setCursor(Number(event.target.value))}
          type="range"
          value={cursor}
        />
      )}
    </section>
  );
}
