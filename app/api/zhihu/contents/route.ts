import { NextResponse, type NextRequest } from "next/server";
import type { RawArticle } from "@/data/models";
import { fetchUserContents, readOAuthConfig, ZhihuAuthError } from "@/lib/zhihu/oauth";
import { getSession, SESSION_COOKIE } from "@/lib/zhihu/session";

export const runtime = "nodejs";

// 单次请求最多翻几页。每页 50 条、串行请求，页数放太大会让浏览器等到超时。
const MAX_PAGES = 5;
// 知乎正文里混有零宽空格，入库前必须剥掉，否则证据锚定的偏移会跟前端渲染对不上。
const clean = (text: string) =>
  text
    .replace(/<\/?em>/g, "")
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const contentIdOf = (url: string) => url.match(/\/(?:p|answer|question|zvideo|pin)\/(\d+)/)?.[1] ?? "";

function requireSession(request: NextRequest) {
  const session = getSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "未连接知乎账号，或会话已过期，请重新连接。" }, { status: 401 }) };
  }
  return { session };
}

export async function GET(request: NextRequest) {
  const { session, error } = requireSession(request);
  if (!session) return error;

  const { config } = readOAuthConfig();
  if (!config) return NextResponse.json({ error: "服务端缺少 OAuth 配置。" }, { status: 500 });

  const requestedPages = Number(new URL(request.url).searchParams.get("pages") ?? 1);
  const pages = Math.min(Math.max(1, Number.isFinite(requestedPages) ? requestedPages : 1), MAX_PAGES);

  const known = new Set(session.contents.map((item) => item.url));
  let offset = 0;
  try {
    for (let page = 0; page < pages; page += 1) {
      const result = await fetchUserContents(config, session.token, { contentType: "article", limit: 50, offset });
      for (const item of result.items) {
        if (!known.has(item.url)) {
          known.add(item.url);
          session.contents.push(item);
        }
      }
      session.contentsFetchedAt = Date.now();
      if (result.isEnd || result.nextOffset === null) break;
      offset = result.nextOffset;
    }
  } catch (cause) {
    const status = cause instanceof ZhihuAuthError ? cause.status : 502;
    const message = cause instanceof Error ? cause.message : "读取知乎创作失败";
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({
    totals: session.contents.length,
    fetchedAt: session.contentsFetchedAt ?? null,
    items: session.contents.map((item) => ({
      url: item.url,
      title: clean(item.title),
      createdAt: item.createdAt,
      publishedAt: new Date(item.createdAt * 1000).toISOString().slice(0, 10),
      // 用户内容接口只给 Summary，没有正文全文，所以这里报的就是摘要字数。
      summaryChars: clean(item.summary).length,
      likeCount: item.likeCount,
      commentCount: item.commentCount,
    })),
  });
}

export async function POST(request: NextRequest) {
  const { session, error } = requireSession(request);
  if (!session) return error;

  const body = await request.json().catch(() => null) as { urls?: unknown } | null;
  const urls = Array.isArray(body?.urls) ? body!.urls.filter((u): u is string => typeof u === "string") : [];
  if (!urls.length) return NextResponse.json({ error: "没有选中任何文章。" }, { status: 400 });

  const wanted = new Set(urls);
  const imported: RawArticle[] = [];
  const skipped: { title: string; reason: string }[] = [];
  for (const item of session.contents) {
    if (!wanted.has(item.url)) continue;
    const id = contentIdOf(item.url);
    const title = clean(item.title);
    const content = clean(item.summary);
    if (!id) { skipped.push({ title, reason: "链接里解析不出内容 ID" }); continue; }
    // 摘要短到一定程度的条目撑不起概念抽取，留着只会拉低整份产物的质量。
    if (content.length < 40) { skipped.push({ title, reason: `可用文本过短（${content.length} 字）` }); continue; }
    imported.push({
      id: `zhihu-${id}`,
      title,
      slug: `zhihu-${id}`,
      publishedAt: new Date(item.createdAt * 1000).toISOString().slice(0, 10),
      sourceUrl: item.url.split("?")[0],
      content,
    });
  }

  const missing = urls.filter((url) => !session.contents.some((item) => item.url === url)).length;
  if (!imported.length) {
    return NextResponse.json({ error: "选中的文章都不可用。", skipped, missing }, { status: 400 });
  }

  imported.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
  // 换一批文章就是一次新的编译，旧结果必须失效，否则展示页会拿上一批的证据冒充这一批。
  session.imported = imported;
  session.importedAt = Date.now();
  session.dataset = undefined;
  session.compiledAt = undefined;

  return NextResponse.json({
    imported: imported.length,
    totalChars: imported.reduce((sum, article) => sum + article.content.length, 0),
    skipped,
    missing,
    importedAt: session.importedAt,
  });
}
