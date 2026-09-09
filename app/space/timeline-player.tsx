"use client";

import { useEffect, useMemo } from "react";
import type { CompiledKnowledgeDataset } from "@/data/models";
import { articlesByDate, conceptIndex } from "@/lib/frontend/dataset";

export interface TimelineState {
  cursor: number;
  total: number;
  revealedIds: string[];
  freshIds: string[];
  currentArticleTitle?: string;
  currentArticleDate?: string;
}

interface Props {
  dataset: CompiledKnowledgeDataset;
  onChange: (state: TimelineState) => void;
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

  useEffect(() => {
    onChange(state);
  }, [onChange, state]);

  const playing = cursor >= 0;

  return (
    <section className="panel mt-3 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="eyebrow hidden sm:inline">知识演变</span>
          <button
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
              playing
                ? "border border-ink/15 text-ink/60 hover:border-coral hover:text-coral"
                : "bg-coral text-white hover:bg-[#004bbb]"
            }`}
            onClick={() => setCursor(playing ? -1 : 0)}
            type="button"
          >
            {playing ? "退出演变" : "▶ 知识演变"}
          </button>
        </div>

        {playing ? (
          <>
            <input
              aria-label="知识演变时间轴"
              className="min-w-[180px] flex-1 accent-coral"
              max={articles.length - 1}
              min={0}
              onChange={(event) => setCursor(Number(event.target.value))}
              type="range"
              value={cursor}
            />
            <p className="min-w-0 max-w-md truncate text-xs text-ink/55">
              <span className="font-mono text-[10px] text-ink/40">
                {state.currentArticleDate} · {cursor + 1}/{state.total}
              </span>
              <span className="mx-2 text-ink/20">|</span>
              <span className="font-bold">{state.currentArticleTitle}</span>
            </p>
            <p className="hidden font-mono text-[10px] text-ink/40 xl:block">
              已出现 {state.revealedIds.length} · 本篇新增 {state.freshIds.length}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-ink/40">从第一篇文章开始查看知识网络如何逐步形成。</p>
        )}
      </div>
    </section>
  );
}
