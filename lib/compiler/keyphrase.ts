import type { RawArticle } from "@/data/models";

// KeyBERT-style keyphrase extraction backed by an OpenAI-compatible
// /embeddings endpoint. The model never names concepts freely — it picks
// from phrases that the document itself surfaces and the embedding model
// ranks as most representative.

// Split on punctuation and common Chinese function words so candidate
// phrases stay clean (e.g. "旋转位置编码" survives, "我们的" does not).
const SPLIT_RE =
  /[\s，。！？、；：""''（）()[\]{}「」『』,.!?;:"'/]+|的|了|是|在|和|我|也|与|及|之|于|以|对|为|而|这|那|其|它|他|她|们|个|到|从|将|被|把|给|让|使|可以|可能|就是|这个|那个|以及|由于|因为|所以|但是|不过|然而|如果|虽然|当|并|且/g;

function extractCandidatePhrases(text: string): string[] {
  const out: string[] = [];
  for (const token of text.split(SPLIT_RE)) {
    if (!token) continue;
    if (/^[一-鿿]{2,8}$/.test(token)) {
      out.push(token);
      continue;
    }
    for (const m of token.matchAll(/[A-Za-z][A-Za-z0-9._-]{1,}/g)) out.push(m[0]);
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export interface KeyphraseConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export async function embedTexts(config: KeyphraseConfig, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/embeddings`;
  const response = await (config.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: config.model, input: texts }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(`Embedding request failed (${response.status}): ${detail || response.statusText}`);
  }
  const envelope = (await response.json()) as { data: { embedding: number[] }[] };
  return envelope.data.map((item) => item.embedding);
}

/**
 * Return the top-K phrases from the article's title + opening that the
 * embedding model ranks most similar to the document. Empty array on
 * failure so callers can fall back to free LLM extraction.
 */
export async function extractKeyphrases(
  article: RawArticle,
  config: KeyphraseConfig,
  topK = 12,
): Promise<string[]> {
  const focus = `${article.title}\n${article.content.slice(0, 800)}`;
  const candidates = [...new Set(extractCandidatePhrases(focus))];
  if (candidates.length < 2) return [];

  let embeddings: number[][];
  try {
    embeddings = await embedTexts(config, [focus, ...candidates]);
  } catch {
    return [];
  }
  const [docEmb, ...candEmbs] = embeddings;
  if (!docEmb || candEmbs.length !== candidates.length) return [];

  const scored = candidates.map((phrase, index) => ({
    phrase,
    score: cosine(docEmb, candEmbs[index]),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(({ phrase }) => phrase);
}
