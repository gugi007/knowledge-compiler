"use client";

import { useEffect, useMemo, useState } from "react";
import type { CompiledKnowledgeDataset } from "@/data/models";
import { articlesByDate, conceptIndex } from "@/lib/frontend/dataset";
import s from "./space.module.css";

/**
 * 知识演变回放（批次 5/5 重绘）。
 *
 * 形态改动：从「工作区之外的整条 panel」改成画布左下角的悬浮胶囊（evoFab）。
 * 默认只显示 `◷ 知识演变 {YYYY.MM → YYYY.MM}`，点击后在胶囊上方展开
 * 一块可拖的时间滑块面板；关闭即退出回放。
 *
 * 语义保持与批次 3 完全一致：
 * - `cursor < 0` 表示未进入回放（父组件据此渲染完整图谱）；
 * - `cursor >= 0` 表示回放中，父组件用 revealedIds 过滤节点与边；
 * - 每次 cursor 变化都通过 onChange 抛出一份 TimelineState。
 *
 * 对外 Props 与批次 3 完全相同（未增未减），调用方无需改动。
 * 日期区间由本组件自行从 dataset 的文章日期算出，父组件不传。
 */

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

/** 胶囊上的区间文案：2023.05 → 2024.04（按语料首尾文章日期算）。 */
function formatMonth(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getFullYear()}.${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

export function TimelinePlayer({ dataset, onChange, cursor, setCursor }: Props) {
  const [open, setOpen] = useState(false);
  const articles = useMemo(() => articlesByDate(dataset), [dataset]);
  const concepts = useMemo(() => conceptIndex(dataset), [dataset]);

  /** 语料日期区间（父组件不传，自己算）。 */
  const range = useMemo(() => {
    if (!articles.length) return "";
    const first = articles[0]!.publishedAt;
    const last = articles[articles.length - 1]!.publishedAt;
    return `${formatMonth(first)} → ${formatMonth(last)}`;
  }, [articles]);

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

  const hasArticles = articles.length > 0;
  /** 展开且语料非空时才算「回放中」。 */
  const expanded = open && hasArticles;
  const playing = expanded && cursor >= 0;

  /** 点胶囊：收起 = 退出回放（cursor 归 -1），展开 = 从第一篇文章开始。 */
  const toggle = () => {
    if (!hasArticles) return;
    if (open) {
      setOpen(false);
      setCursor(-1);
      return;
    }
    setOpen(true);
    if (cursor < 0) setCursor(0);
  };

  return (
    /* 由 space-view 挂进 GraphCanvas 的 overlay，渲染在 .stage 内部：
       收起态：左下角小胶囊；展开态：胶囊本身变成一条横跨画布底部的横条，
       不再「上面大面板 + 下面小胶囊」两层，把中央节点让出来。 */
    <div className={s.evoWrap}>
      {expanded ? (
        <div className={s.evoBar}>
          <span aria-hidden className={s.evoIco}>
            ◷
          </span>
          <span className={s.evoLabel}>知识演变</span>
          <span className={s.evoMono}>{range}</span>
          <input
            aria-label="知识演变时间轴"
            className={s.evoSlider}
            max={Math.max(articles.length - 1, 0)}
            min={0}
            onChange={(event) => setCursor(Number(event.target.value))}
            type="range"
            value={cursor < 0 ? 0 : cursor}
          />
          <span className={s.evoMono}>
            {cursor + 1}/{state.total}
          </span>
          <span className={s.evoCurrent}>
            {state.currentArticleDate} · {state.currentArticleTitle}
          </span>
          <button
            aria-label="收起知识演变"
            className={s.evoClose}
            onClick={toggle}
            type="button"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          aria-expanded={expanded}
          aria-label="知识演变回放"
          aria-pressed={playing}
          className={`${s.evoFab} ${s.evoFabInline}`}
          onClick={toggle}
          type="button"
        >
          <span aria-hidden className={s.evoIco}>
            ◷
          </span>
          <span className={s.evoLabel}>知识演变</span>
          <span className={s.evoRange}>{range || "暂无文章"}</span>
        </button>
      )}
    </div>
  );
}
