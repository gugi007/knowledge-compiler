"use client";

import { useState } from "react";
import Link from "next/link";
import type { CompiledKnowledgeDataset } from "@/data/models";
import type { CompileStage } from "@/lib/compiler/compile";

const stages: { id: CompileStage; label: string }[] = [
  { id: "parsing-articles", label: "Parsing articles" },
  { id: "extracting-concepts", label: "Extracting concepts" },
  { id: "resolving-concepts", label: "Resolving concepts" },
  { id: "synthesizing-relations", label: "Synthesizing relations" },
  { id: "building-reading-paths", label: "Building reading paths" },
];

export default function CompilePage() {
  const [running, setRunning] = useState(false);
  const [activeStage, setActiveStage] = useState<CompileStage>();
  const [completedStages, setCompletedStages] = useState<CompileStage[]>([]);
  const [result, setResult] = useState<CompiledKnowledgeDataset>();
  const [error, setError] = useState<string>();

  async function compileDemo() {
    sessionStorage.removeItem("knowledge-compiler:dataset");
    setRunning(true);
    setResult(undefined);
    setError(undefined);
    setActiveStage(undefined);
    setCompletedStages([]);
    let previousStage: CompileStage | undefined;

    try {
      const response = await fetch("/api/compile", { method: "POST" });
      if (!response.ok || !response.body) throw new Error(`Compile request failed (${response.status})`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleLine = async (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as {
          type?: string;
          stage?: CompileStage;
          dataset?: CompiledKnowledgeDataset;
          message?: string;
        };
        if (event.type === "stage" && stages.some(({ id }) => id === event.stage)) {
          if (previousStage) setCompletedStages((current) => [...new Set([...current, previousStage!])]);
          previousStage = event.stage;
          setActiveStage(event.stage);
          await new Promise((resolve) => setTimeout(resolve, 220));
        } else if (event.type === "complete" && event.dataset) {
          sessionStorage.setItem("knowledge-compiler:dataset", JSON.stringify(event.dataset));
          setCompletedStages(stages.map(({ id }) => id));
          setActiveStage(undefined);
          setResult(event.dataset);
        } else if (event.type === "error") {
          throw new Error(event.message || "Knowledge compilation failed");
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) await handleLine(line);
        if (done) break;
      }
      if (buffer.trim()) await handleLine(buffer);
      if (!result && !sessionStorage.getItem("knowledge-compiler:dataset")) {
        throw new Error("Compiler finished without a dataset");
      }
    } catch (cause) {
      setActiveStage(undefined);
      setError(cause instanceof Error ? cause.message : "Knowledge compilation failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="glass-bar -mx-4 mb-2 flex items-center justify-between px-4 py-3 md:-mx-8 md:px-8">
          <Link className="font-display text-xl font-semibold" href="/">Knowledge Compiler</Link>
          <span className="text-[10px] font-bold tracking-[0.18em] text-ink/45 uppercase">Compile MVP</span>
        </header>

        <section className="py-14 text-center md:py-20">
          <p className="eyebrow">Article → Knowledge Model</p>
          <h1 className="mx-auto mt-4 max-w-3xl font-display text-4xl leading-tight font-semibold tracking-tight md:text-6xl">
            Turn scattered articles into<br />a personal knowledge model.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-ink/60">
            使用仓库中的 Demo Articles，运行当前配置的真实 Compiler pipeline。
          </p>
          <button
            className="mt-8 rounded-full bg-coral px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-[#004bbb] disabled:cursor-wait disabled:opacity-60"
            disabled={running}
            onClick={compileDemo}
            type="button"
          >
            {running ? "Compiling…" : "Use Demo Articles"}
          </button>
        </section>

        <section aria-live="polite" className="panel mx-auto max-w-2xl p-5 md:p-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Compiler stages</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">Build knowledge model</h2>
            </div>
            <span className={`size-3 rounded-full ${running ? "animate-pulse bg-coral" : result ? "bg-emerald-600" : "bg-ink/15"}`} />
          </div>

          <ol className="mt-6 space-y-2">
            {stages.map((stage, index) => {
              const complete = completedStages.includes(stage.id);
              const active = activeStage === stage.id;
              return (
                <li className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${active ? "bg-lime/55 font-bold" : "bg-white text-ink/60"}`} key={stage.id}>
                  <span className={`grid size-6 place-items-center rounded-full font-mono text-[10px] font-bold ${complete ? "bg-ink text-paper" : active ? "bg-coral text-white" : "border border-ink/15"}`}>
                    {complete ? "✓" : index + 1}
                  </span>
                  {stage.label}
                </li>
              );
            })}
          </ol>

          {error && <p className="mt-5 rounded-xl border border-red-500/25 bg-red-50 p-3 text-sm leading-6 text-red-700">{error}</p>}

          {result && (
            <div className="mt-6 border-t border-ink/10 pt-6">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ResultStat label="Articles" value={result.articles.length} />
                <ResultStat label="Concepts" value={result.concepts.length} />
                <ResultStat label="Relations" value={result.relations.length} />
                <ResultStat label="Reading Paths" value={result.readingPaths.length} />
              </div>
              <p className="mt-4 text-center font-mono text-[11px] text-ink/45">
                {result.compiler.provider} · {result.compiler.mode}
              </p>
              {/* legacy 参考实现：指向同为 legacy 的三栏视图，
                  v2 的对应流程是 /compile → /space。 */}
              <Link className="mt-5 block rounded-full bg-coral px-5 py-3 text-center text-sm font-bold text-white transition hover:bg-[#004bbb]" href="/legacy?source=compiled">
                Explore Knowledge World →
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-3 text-center">
      <strong className="font-display text-2xl">{value}</strong>
      <p className="text-[9px] font-bold tracking-wider text-ink/40 uppercase">{label}</p>
    </div>
  );
}
