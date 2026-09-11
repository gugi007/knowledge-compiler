import type { RawArticle } from "@/data/models";
import type { ZhihuContentItem } from "./oauth.ts";

// 「知乎创作条目 → RawArticle」的**唯一**投影实现。两处调用方必须都走这里：
// - `POST /api/zhihu/contents`：用户在导入面板里勾选后写进 session.imported；
// - `POST /api/compile` 的 imported 语料：按需补齐时投影预热的创作列表。
// 这份逻辑含 ID 合成、摘要清洗和字数下限过滤，复制第二份必然漂移，而漂移会直接
// 改变编译产物的证据锚定（quote 必须逐字来自 content）。
//
// 平台边界：用户内容接口只返回 Summary（约 200–320 字），拿不到正文全文，
// 所以这里的 content 就是摘要。这是知乎的限制，不是实现缺陷。

/** 摘要短到一定程度的条目撑不起概念抽取，留着只会拉低整份产物的质量。 */
export const MIN_SUMMARY_CHARS = 40;

/** 知乎正文里混有零宽空格，入库前必须剥掉，否则证据锚定的偏移会跟前端渲染对不上。 */
export function clean(text: string): string {
  return text
    .replace(/<\/?em>/g, "")
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 从创作链接里取内容 ID（`/p/123`、`/answer/456` 等）。取不到返回空串，由调用方决定怎么报。 */
export function contentIdOf(url: string): string {
  return url.match(/\/(?:p|answer|question|zvideo|pin)\/(\d+)/)?.[1] ?? "";
}

/** 秒级时间戳 → `YYYY-MM-DD`，与仓库里语料 publishedAt 的口径一致。 */
function publishedDateOf(createdAt: number): string {
  return new Date(createdAt * 1000).toISOString().slice(0, 10);
}

export interface SkippedContent {
  title: string;
  reason: string;
}

/**
 * 投影的三类结果：`imported` 可用、`skipped` 不可用（带原因）、`missing` 会话里
 * 根本没有这条 URL。三种调用方的响应体不同，但判定口径必须是同一份。
 */
export interface ContentProjection {
  imported: RawArticle[];
  skipped: SkippedContent[];
  missing: number;
}

/**
 * 统一排序。产物的 ID 生成与文章顺序相关，按发布时间排序才能让同一批输入
 * 每次都产出同一份结果（demo / bayes 语料也是这个口径）。
 */
export function sortArticles(articles: RawArticle[]): RawArticle[] {
  return [...articles].sort(
    (a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id),
  );
}

/**
 * 按选中的 URL 投影。`selectedUrls` 是用户在导入面板里勾选的那批；
 * 会话缓存里没有的记进 `missing`（不报错，由调用方决定是提示还是忽略）。
 */
export function projectContents(
  items: readonly ZhihuContentItem[],
  selectedUrls: readonly string[],
): ContentProjection {
  const wanted = new Set(selectedUrls);
  const imported: RawArticle[] = [];
  const skipped: SkippedContent[] = [];

  for (const item of items) {
    if (!wanted.has(item.url)) continue;
    const title = clean(item.title);
    const id = contentIdOf(item.url);
    const content = clean(item.summary);
    if (!id) { skipped.push({ title, reason: "链接里解析不出内容 ID" }); continue; }
    // createdAt 不可解析时 toISOString 会直接抛 RangeError，整条链路会莫名其妙地失败。
    // 平台给出垃圾值时按「这篇不可用」处理，比让编译崩掉好。
    if (!Number.isFinite(item.createdAt)) { skipped.push({ title, reason: "创建时间无法解析" }); continue; }
    if (content.length < MIN_SUMMARY_CHARS) { skipped.push({ title, reason: `可用文本过短（${content.length} 字）` }); continue; }
    imported.push({
      id: `zhihu-${id}`,
      title,
      slug: `zhihu-${id}`,
      publishedAt: publishedDateOf(item.createdAt),
      sourceUrl: item.url.split("?")[0],
      content,
    });
  }

  const known = new Set(items.map((item) => item.url));
  return {
    imported: sortArticles(imported),
    skipped,
    missing: selectedUrls.filter((url) => !known.has(url)).length,
  };
}

/** 不筛选，投影会话里的全部创作。imported 语料的按需补齐走这条。 */
export function projectAllContents(items: readonly ZhihuContentItem[]): ContentProjection {
  return projectContents(items, items.map((item) => item.url));
}
