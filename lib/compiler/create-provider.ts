import { OpenAICompatibleLLMProvider } from "./llm-provider.ts";
import { DeterministicMockProvider } from "./mock-provider.ts";
import type { ExtractionProvider } from "./provider.ts";

export function createCompilerProvider(
  environment: Record<string, string | undefined> = process.env,
): ExtractionProvider {
  const provider = environment.KNOWLEDGE_COMPILER_PROVIDER ?? "mock";
  if (provider === "mock") return new DeterministicMockProvider();
  if (provider !== "llm") {
    throw new Error(`Unsupported KNOWLEDGE_COMPILER_PROVIDER: ${provider}. Use "mock" or "llm".`);
  }

  const required = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"] as const;
  const missing = required.filter((name) => !environment[name]?.trim());
  if (missing.length) {
    throw new Error(`KNOWLEDGE_COMPILER_PROVIDER=llm requires ${missing.join(", ")}`);
  }

  return new OpenAICompatibleLLMProvider({
    baseUrl: environment.LLM_BASE_URL!,
    apiKey: environment.LLM_API_KEY!,
    model: environment.LLM_MODEL!,
    ...(environment.LLM_EMBEDDING_MODEL ? { embeddingModel: environment.LLM_EMBEDDING_MODEL } : {}),
  });
}
