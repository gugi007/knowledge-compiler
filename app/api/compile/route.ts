import { NextResponse, type NextRequest } from "next/server";
import demoCreator from "@/data/demo/creator.json";
import demoArticles from "@/data/demo/articles/articles.json";
import bayesCreator from "@/data/bayes/creator.json";
import bayesArticles from "@/data/bayes/articles/articles.json";
import type { Creator, RawArticle } from "@/data/models";
import {
  compileKnowledge,
  computeProgress,
  createCompilerProvider,
  EMPTY_STAGE_COUNTS,
  type StageCounts,
} from "@/lib/compiler";
import {
  assertCompiledKnowledgeDataset,
  assertRawArticle,
} from "@/lib/compiler/schema";
import {
  fetchAllUserContents,
  readOAuthConfig,
  ZhihuAuthError,
  type ZhihuUserProfile,
} from "@/lib/zhihu/oauth";
import { projectAllContents } from "@/lib/zhihu/project";
import { getSession, pushContents, SESSION_COOKIE } from "@/lib/zhihu/session";

export const runtime = "nodejs";

// 可编译的仓库内置语料。只放人工样例与公开演示语料；
// zhihu-gugi / zhihu-gugi-fulltext 不进这里（第三方抓取数据不随仓库走）。
const CORPORA = {
  demo: { creator: demoCreator, articles: demoArticles },
  bayes: { creator: bayesCreator, articles: bayesArticles },
} as const;

type CorpusId = keyof typeof CORPORA | "imported";
type CompileMode = "compile" | "replay";

const CORPUS_IDS: readonly string[] = ["demo", "bayes", "imported"];
const MODES: readonly string[] = ["compile", "replay"];

/** creator.focus 取多少个领域。多到能看出方向即可，不铺满整行。 */
const MAX_CREATOR_FOCUS = 6;

/**
 * 导入语料的 Creator。用户资料端点（`fetchUserProfile`）未文档化、可能拿不到，
 * 所以每个字段都有合成值兜底：拿不到真名就退回「我的知乎创作 / @知乎账号」，
 * 链路照样跑通，只是作者栏不好看。
 *
 * `focus` 只能等编译完从产物回填（领域是编译出来的），这里先留空数组。
 * `articleIds` 由 compileKnowledge 自己填。
 */
function importedCreatorFor(profile: ZhihuUserProfile | undefined, articleCount: number): Creator {
  return {
    id: profile?.Id || "creator-zhihu-oauth",
    name: profile?.Name || "我的知乎创作",
    handle: profile?.UrlToken ? `@${profile.UrlToken}` : "@知乎账号",
    bio: `通过知乎 OAuth 授权读取的本人 ${articleCount} 篇公开创作。开放平台只返回标题与摘要（约 200–320 字），不含正文全文。`,
    focus: [],
    articleIds: [],
  };
}

/**
 * 从产物回填创作方向：按概念数排序取前几个领域。
 * 只去重是不够的——概念多的领域才代表这个作者真正的重心。
 */
function focusFromConcepts(concepts: readonly { domain: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const { domain } of concepts) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_CREATOR_FOCUS)
    .map(([domain]) => domain);
}

/**
 * POST /api/compile
 *
 * JSON body：`{ corpus?, mode? }`。
 * - corpus：demo（默认）| bayes | imported（当前 Zhihu 会话的创作）
 * - mode：compile（默认）| replay。replay 只是契约占位，服务端尚未实现，
 *   传 replay 会得到 501，不会假装重放。
 *
 * imported 语料按需补齐：用户在导入面板挑过就用那份，否则用登录预热好的创作列表投影，
 * 预热没赶上才现抓。前端因此不需要先手点一次「导入」，`?corpus=imported` 直接可编译。
 *
 * 参数非法 → HTTP 400 JSON；缺省 body 时维持旧行为（等价 corpus=demo）。
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    corpus?: unknown;
    mode?: unknown;
  } | null;

  if (body?.corpus !== undefined && !CORPUS_IDS.includes(body.corpus as string)) {
    return NextResponse.json(
      { error: `corpus 必须是 ${CORPUS_IDS.join(" / ")} 之一。` },
      { status: 400 },
    );
  }
  if (body?.mode !== undefined && !MODES.includes(body.mode as string)) {
    return NextResponse.json(
      { error: `mode 必须是 ${MODES.join(" / ")} 之一。` },
      { status: 400 },
    );
  }
  const corpusId = (body?.corpus ?? "demo") as CorpusId;
  const mode = (body?.mode ?? "compile") as CompileMode;
  if (mode === "replay") {
    return NextResponse.json(
      { error: "replay 模式尚未实现，请使用 compile。" },
      { status: 501 },
    );
  }

  const session = getSession(request.cookies.get(SESSION_COOKIE)?.value);

  // imported 语料按需补齐。决议在流外完成：三种「拿不到语料」都要沿用 HTTP 400
  // （客户端的 handleCompileResponse 会把它归一化成一条 error 事件），只有真的要编译才进流。
  let importedArticles: RawArticle[] | undefined;
  // 慢路径标记：只有它需要在 compileKnowledge 之前补一条解析阶段事件——
  // 上游要串行翻最多 5 页，这段时间用户看不到任何进度。
  let slowPath = false;

  if (corpusId === "imported") {
    if (!session) {
      return NextResponse.json(
        { error: "未连接知乎账号，或会话已过期。请先连接知乎账号再编译。" },
        { status: 400 },
      );
    }

    if (session.imported.length) {
      // 用户在导入面板里显式挑过文章：尊重那次选择，不做任何上游调用。
      importedArticles = session.imported;
    } else {
      if (!session.contents.length) {
        // 慢路径：预热没赶上（登录前建的旧会话、预热失败，或 dev 演练直接进编译台）。
        const { config } = readOAuthConfig();
        if (!config) {
          return NextResponse.json({ error: "服务端缺少 OAuth 配置。" }, { status: 500 });
        }
        try {
          pushContents(session, await fetchAllUserContents(config, session.token));
        } catch (cause) {
          const status = cause instanceof ZhihuAuthError ? cause.status : 502;
          return NextResponse.json(
            { error: cause instanceof Error ? cause.message : "读取知乎创作失败" },
            { status },
          );
        }
        slowPath = true;
      }
      // 快路径（contents 已由登录预热写好）在这里是零上游调用：投影是纯函数。
      importedArticles = projectAllContents(session.contents).imported;
      if (!importedArticles.length) {
        return NextResponse.json(
          { error: "没有可用的知乎创作。开放平台只返回摘要，过短的条目无法支撑概念抽取。" },
          { status: 400 },
        );
      }
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      void (async () => {
        try {
          let creator: Creator;
          let articles: RawArticle[];

          if (corpusId === "imported") {
            articles = importedArticles!;
            creator = importedCreatorFor(session!.profile, articles.length);
            if (slowPath) {
              // 形状严格照 lib/compiler/progress.ts 的 CompileProgressEvent：
              // stage + counts + progress。这里只报「刚补齐了多少篇」，让用户立刻看到
              // 语料规模；紧接着 compileKnowledge 会再发一条同阶段的权威事件。
              const counts: StageCounts = { ...EMPTY_STAGE_COUNTS, articlesTotal: articles.length };
              send({
                type: "stage",
                stage: "parsing-articles",
                counts,
                progress: computeProgress("parsing-articles", counts),
              });
            }
          } else {
            const corpus = CORPORA[corpusId];
            creator = corpus.creator as Creator;
            articles = corpus.articles.map((value, index) => {
              assertRawArticle(value, `${corpusId}.articles[${index}]`);
              return value;
            });
          }

          const dataset = await compileKnowledge({
            creator,
            articles,
            provider: createCompilerProvider(),
            // 事件对象原样转发：stage 带 counts 与 progress；
            // 将来管线接上 tick / snapshot 也不需要再改这里。
            onProgress: (event) => send(event),
          });
          if (corpusId === "imported") {
            // 创作方向只有编译完才知道，所以在校验之前从产物回填 creator.focus。
            dataset.creator.focus = focusFromConcepts(dataset.concepts);
          }
          assertCompiledKnowledgeDataset(dataset);
          // 只在成功时替换上次结果：编译失败要保留旧产物，展示页才不会空掉。
          if (corpusId === "imported") {
            session!.dataset = dataset;
            session!.compiledAt = Date.now();
          }
          send({ type: "complete", dataset });
        } catch (error) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : "Knowledge compilation failed",
          });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
    },
  });
}
