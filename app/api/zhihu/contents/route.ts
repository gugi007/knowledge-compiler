import { NextResponse, type NextRequest } from "next/server";
import { fetchUserContents, MAX_CONTENT_PAGES, readOAuthConfig, ZhihuAuthError } from "@/lib/zhihu/oauth";
import { clean, projectContents } from "@/lib/zhihu/project";
import { getSession, pushContents, SESSION_COOKIE } from "@/lib/zhihu/session";

export const runtime = "nodejs";

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
  const pages = Math.min(Math.max(1, Number.isFinite(requestedPages) ? requestedPages : 1), MAX_CONTENT_PAGES);

  let offset = 0;
  try {
    for (let page = 0; page < pages; page += 1) {
      const result = await fetchUserContents(config, session.token, { limit: 50, offset });
      pushContents(session, result.items);
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

  // 投影逻辑只有 lib/zhihu/project.ts 一份：/api/compile 的 imported 语料补齐走的是同一份。
  const { imported, skipped, missing } = projectContents(session.contents, urls);
  if (!imported.length) {
    return NextResponse.json({ error: "选中的文章都不可用。", skipped, missing }, { status: 400 });
  }

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
