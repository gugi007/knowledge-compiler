import { NextResponse, type NextRequest } from "next/server";
import demoCreator from "@/data/demo/creator.json";
import demoArticles from "@/data/demo/articles/articles.json";
import sujianlinCreator from "@/data/sujianlin/creator.json";
import sujianlinArticles from "@/data/sujianlin/articles/articles.json";
import type { Creator, RawArticle } from "@/data/models";
import {
  compileKnowledge,
  createCompilerProvider,
  type CompileStage,
} from "@/lib/compiler";
import {
  assertCompiledKnowledgeDataset,
  assertRawArticle,
} from "@/lib/compiler/schema";
import { getSession, SESSION_COOKIE } from "@/lib/zhihu/session";

export const runtime = "nodejs";

// 可编译的仓库内置语料。只放人工样例与公开演示语料；
// zhihu-gugi / zhihu-gugi-fulltext 不进这里（第三方抓取数据不随仓库走）。
const CORPORA = {
  demo: { creator: demoCreator, articles: demoArticles },
  sujianlin: { creator: sujianlinCreator, articles: sujianlinArticles },
} as const;

type CorpusId = keyof typeof CORPORA | "imported";
type CompileMode = "compile" | "replay";

const CORPUS_IDS: readonly string[] = ["demo", "sujianlin", "imported"];
const MODES: readonly string[] = ["compile", "replay"];

// 用户内容接口不返回作者资料，所以导入语料的 Creator 只能这样合成。
// articleIds 由 compileKnowledge 自己填，这里留空即可。
const importedCreator: Creator = {
  id: "creator-zhihu-oauth",
  name: "我的知乎创作",
  handle: "@知乎账号",
  bio: "通过知乎 OAuth 授权读取的本人公开创作。开放平台只返回标题与摘要，不含正文全文。",
  focus: [],
  articleIds: [],
};

/**
 * POST /api/compile
 *
 * JSON body：`{ corpus?, mode? }`。
 * - corpus：demo（默认）| sujianlin | imported（当前 Zhihu 会话的导入文章）
 * - mode：compile（默认）| replay。replay 只是契约占位，服务端尚未实现，
 *   传 replay 会得到 501，不会假装重放。
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
  if (corpusId === "imported" && !session?.imported.length) {
    return NextResponse.json(
      { error: "还没有导入任何文章。请先连接知乎账号并选择文章。" },
      { status: 400 },
    );
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
            creator = importedCreator;
            articles = session!.imported;
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
            onProgress: (stage: CompileStage) => send({ type: "stage", stage }),
          });
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
