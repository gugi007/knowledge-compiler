import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import type { RawArticle } from "@/data/models";
import type { ZhihuUserProfile } from "@/lib/zhihu/oauth";
import { MIN_SUMMARY_CHARS, sortArticles } from "@/lib/zhihu/project";
import {
  createSession,
  getSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/zhihu/session";

export const runtime = "nodejs";

// 赛前演练通道（dev-only）。9/13 才有 OAuth 凭证，没有它整条链路的首次运行会押在
// 提交当天。它把 sample18 的 18 篇真实知乎语料注入会话，之后走的就是与真链路
// **完全相同的代码**：/compile?corpus=imported → 服务端按需补齐 → 编译 → 知识空间。
//
// 为什么必须截断正文：sample18 的 content 是 9,004 / 3,073 / 6,300 / 5,790 / 12,461 字的
// 全文，而真实链路只有 Summary（约 200–320 字）。不截断会严重高估产物质量，
// 到 9/13 用真摘要跑才发现图谱稀薄。

const SAMPLE_FILE = "data/sujianlin-zhihu-sample18/articles/articles.json";
const DEFAULT_CHARS = 280;
const MAX_CHARS = 20000;

/**
 * 假资料。必须一眼看出不是真实账号——演练产物里的作者名会显示它，
 * 免得被人当成真用户的昵称。存在的意义是验证 creator 的 profile 构造路径
 * （而不是每次都退回到「我的知乎创作 / @知乎账号」）。
 */
const DEV_PROFILE: ZhihuUserProfile = {
  Id: "dev-seed-user",
  Name: "苏剑林（本地演练）",
  UrlToken: "dev-seed",
  Headline: "dev-only 演练假资料，不是真实知乎账号",
};

/** 假 token：只在内存里活一次演练，任何真实上游调用都会因它而失败（这正是慢路径的表现）。 */
function devToken() {
  return { accessToken: "dev-seed-token", expiresAt: Date.now() + 60 * 60 * 1000 };
}

function clampChars(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_CHARS;
  // 下限锚在投影的字数门槛上：截得比它还短，整份语料会被过滤成空，演练就失去意义。
  return Math.min(MAX_CHARS, Math.max(MIN_SUMMARY_CHARS, Math.round(value)));
}

/**
 * 截到约 `chars` 字，优先在句末收尾，模拟摘要的语感；
 * 切点落在后段太靠前（不足目标的 60%）就退回硬截，避免篇篇只剩半句。
 */
function truncate(text: string, chars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= chars) return flat;
  const window = flat.slice(0, chars);
  const boundary = Math.max(
    window.lastIndexOf("。"),
    window.lastIndexOf("！"),
    window.lastIndexOf("？"),
    window.lastIndexOf("；"),
  );
  return (boundary >= chars * 0.6 ? window.slice(0, boundary + 1) : window).trim();
}

async function seed(request: NextRequest) {
  // 生产环境必须不可用：这个路由会凭空造出一个「已授权」会话。
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const chars = clampChars(Number(params.get("chars") ?? DEFAULT_CHARS));
  // imported=0：不写 session.imported，逼 /api/compile 走「contents → 投影」的快路径。
  // 那条才是真链路登录后的实际入口——预热只写 contents，从来不写 imported。
  const seedImported = params.get("imported") !== "0";

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(process.cwd(), SAMPLE_FILE), "utf8"));
  } catch {
    return NextResponse.json(
      { error: `读不到演练语料 ${SAMPLE_FILE}（该目录已 gitignore，需要本地存在）。` },
      { status: 500 },
    );
  }

  const source = Array.isArray(parsed)
    ? parsed
    : (parsed as { articles?: unknown } | null)?.articles;
  if (!Array.isArray(source)) {
    return NextResponse.json({ error: `演练语料 ${SAMPLE_FILE} 的结构不是文章数组。` }, { status: 500 });
  }

  const articles: RawArticle[] = [];
  for (const value of source as RawArticle[]) {
    if (!value || typeof value.content !== "string") continue;
    articles.push({ ...value, content: truncate(value.content, chars) });
  }
  if (!articles.length) {
    return NextResponse.json({ error: "演练语料里没有可用的文章。" }, { status: 500 });
  }
  const sorted = sortArticles(articles);

  // 会话：已有就用已有的，没有就现造一个——9/13 之前没有凭证，回调根本走不通。
  const existing = getSession(request.cookies.get(SESSION_COOKIE)?.value);
  const sessionId = existing ? request.cookies.get(SESSION_COOKIE)!.value : createSession(devToken());
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "无法建立演练会话。" }, { status: 500 });
  }

  session.profile = DEV_PROFILE;
  // 摘要口径：截断后的正文就是 trim 后的 Summary，投影与导入面板读的是同一份。
  session.contents = sorted.map((article) => ({
    contentType: "article",
    url: article.sourceUrl,
    createdAt: Math.floor(new Date(`${article.publishedAt}T00:00:00Z`).getTime() / 1000),
    likeCount: 0,
    commentCount: 0,
    favoriteCount: 0,
    title: article.title,
    summary: article.content,
  }));
  session.contentsFetchedAt = Date.now();

  if (seedImported) {
    session.imported = sorted;
    session.importedAt = Date.now();
    // 换语料就是一次新的编译：旧产物必须失效，否则展示页拿上一批的证据冒充这一批。
    session.dataset = undefined;
    session.compiledAt = undefined;
  }

  const response = NextResponse.json({
    seeded: {
      profile: DEV_PROFILE.Name,
      articles: sorted.length,
      imported: seedImported ? sorted.length : 0,
      contents: session.contents.length,
      chars,
      totalChars: sorted.reduce((sum, article) => sum + article.content.length, 0),
      firstTitle: sorted[0]?.title ?? null,
    },
    next: seedImported
      ? "打开 /compile?corpus=imported 点「开始编译」。"
      : "session.imported 为空：/compile?corpus=imported 会走「contents → 投影」快路径。",
  });
  // 只有新建会话时才设 cookie；复用已有会话不必重发（重发会刷新它的有效期）。
  if (!existing) response.cookies.set({ name: SESSION_COOKIE, value: sessionId, ...sessionCookieOptions() });
  return response;
}

/** GET 便于直接在地址栏演练；POST 便于脚本调用。两者行为完全一致。 */
export async function GET(request: NextRequest) {
  return seed(request);
}

export async function POST(request: NextRequest) {
  return seed(request);
}
