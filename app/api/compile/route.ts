import creatorValue from "@/data/demo/creator.json";
import articleValues from "@/data/demo/articles/articles.json";
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

export const runtime = "nodejs";

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      void (async () => {
        try {
          const articles: RawArticle[] = articleValues.map((value, index) => {
            assertRawArticle(value, `demo.articles[${index}]`);
            return value;
          });
          const dataset = await compileKnowledge({
            creator: creatorValue as Creator,
            articles,
            provider: createCompilerProvider(),
            onProgress: (stage: CompileStage) => send({ type: "stage", stage }),
          });
          assertCompiledKnowledgeDataset(dataset);
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
