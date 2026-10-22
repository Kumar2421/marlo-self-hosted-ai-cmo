import type { LlmDriver } from "./types";
import anthropicDriver from "./anthropic";
import openaiDriver from "./openai";
import googleDriver from "./google";
import groqDriver from "./groq";
import mistralDriver from "./mistral";

export * from "./types";

/**
 * Only providers with a real driver wired here can actually answer a chat
 * message. Providers listed in lib/mock-providers.ts but missing from this map
 * (xAI, OpenRouter) can still be "connected" in the UI/DB, but /api/chat
 * returns a clear "not wired yet" error for them instead of silently failing
 * or pretending to answer.
 *
 * groq/mistral are also the two PLATFORM_PROVIDER_KEYS (see
 * lib/llm/platformKeys.ts) — every agent/document route's platform-key
 * fallback depends on these actually being wired, not just "connectable".
 *
 * lmstudio/ollama/custom all reuse the OpenAI driver — they're all
 * OpenAI-compatible `/v1/chat/completions` servers, just with a different
 * baseUrl and (usually) no real API key. One driver, three registry entries.
 */
export const DRIVERS: Record<string, LlmDriver> = {
  anthropic: anthropicDriver,
  openai: openaiDriver,
  google: googleDriver,
  groq: groqDriver,
  mistral: mistralDriver,
  lmstudio: openaiDriver,
  ollama: openaiDriver,
  custom: openaiDriver,
};

export function getDriver(providerId: string): LlmDriver | null {
  return DRIVERS[providerId] ?? null;
}

/** Only the OpenAI-compatible driver implements the tool-call loop (see
 * openai.ts) — anthropic.ts/google.ts silently ignore a `tools` array since
 * they never read it, which is harmless but means the model never actually
 * gets the tool, even though a system prompt written for it would claim
 * otherwise. groq/mistral reuse the OpenAI driver under the hood so they get
 * the same tool loop for free. Callers should check this before deciding to
 * pass tools/build a tool-aware system prompt for a given provider. */
export { providerSupportsTools } from "./capabilities";
