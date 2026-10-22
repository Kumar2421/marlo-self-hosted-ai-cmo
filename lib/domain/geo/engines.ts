import { ASK_TIMEOUT_MS, codeForStatus, GeoProviderError } from "./providerError.ts";
import type { AnswerMethod, EngineAnswer } from "./types.ts";

/** A way of asking one prompt. The method it reports is what every stored row is tagged with. */
export interface AnswerPort {
  readonly method: AnswerMethod;
  /** Honest, human-readable name of what actually answered. */
  readonly engine: string;
  ask(prompt: string): Promise<EngineAnswer>;
}

/** Stable model that supports Grounding with Google Search. Override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type GroundingResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  }>;
};

export function parseGeminiResponse(data: unknown): EngineAnswer {
  const cand = (data as GroundingResponse)?.candidates?.[0];
  const answer = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  const urls: string[] = [];
  for (const chunk of cand?.groundingMetadata?.groundingChunks ?? []) {
    const web = chunk.web;
    // Grounding URIs are usually vertexaisearch redirect links; the title is the real site domain.
    const title = web?.title?.trim();
    const candidate = title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title) ? `https://${title.toLowerCase()}/` : web?.uri;
    if (candidate && !urls.includes(candidate)) urls.push(candidate);
  }
  return { answer, citedUrls: urls };
}

/** Real Gemini API with the Google Search grounding tool. */
export function createGeminiGroundedPort(opts: { apiKey: string; model?: string; fetchImpl?: FetchLike; timeoutMs?: number }): AnswerPort {
  const model = opts.model || DEFAULT_GEMINI_MODEL;
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    method: "gemini-grounded",
    engine: "Gemini with Google Search",
    async ask(prompt) {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          // Key goes in a header, never the URL, so it cannot leak into logs.
          headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? ASK_TIMEOUT_MS),
        });
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        throw new GeoProviderError(timedOut ? "timeout" : "network", timedOut ? "Gemini did not answer in time." : "Gemini request failed: network error.");
      }
      if (!res.ok) throw new GeoProviderError(codeForStatus(res.status), `Gemini request failed: HTTP ${res.status}`, res.status);
      const parsed = parseGeminiResponse(await res.json());
      if (!parsed.answer) throw new GeoProviderError("empty", "Gemini returned an empty answer.");
      return parsed;
    },
  };
}

export type SearchHit = { title: string; url: string; content: string };

/**
 * NOT a real AI engine. Runs a web search (Tavily) and asks a free LLM (Groq)
 * to write the answer from those results. A rough proxy only; always tagged "simulated".
 */
export function createSimulatedPort(opts: {
  search: (query: string) => Promise<SearchHit[]>;
  complete: (system: string, user: string) => Promise<string>;
}): AnswerPort {
  return {
    method: "simulated",
    engine: "Simulated (search results + Groq answer)",
    async ask(prompt) {
      const hits = await opts.search(prompt);
      const context = hits.map((h, i) => `[${i + 1}] ${h.title} (${h.url})\n${h.content.slice(0, 500)}`).join("\n\n");
      const answer = await opts.complete(
        "You are a helpful assistant answering a buyer's question. Use the search results below. Recommend specific products or companies by name.",
        `Question: ${prompt}\n\nSearch results:\n${context || "(none)"}`,
      );
      return { answer: answer.trim(), citedUrls: hits.map((h) => h.url) };
    },
  };
}
