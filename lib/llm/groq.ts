import type { LlmDriver } from "./types";
import openaiDriver from "./openai";
import { safeBaseUrl } from "./platformKeys";
import { isModelNotFound, modelAttempts } from "./modelFallback";

/** Groq retires models quickly. If the requested id is gone, fall back to these (best first). */
const GROQ_FALLBACK_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"] as const;

/** Groq's API is OpenAI-compatible (chat completions, tool calling) at a
 * different host — reuse the OpenAI driver's whole request/stream/tool-loop
 * implementation instead of duplicating it, just pin the right base URL.
 * BYOK connections can still override baseUrl (self-host pointing at a proxy,
 * say) — this only supplies the default when none was given, which is the
 * case for the platform-provided-key path (see lib/llm/platformKeys.ts).
 *
 * A retired model id answers 404; instead of failing the whole feature we
 * retry once per known fallback model, and only surface the original error
 * if none of them works either. */
const groqDriver: LlmDriver = async (req) => {
  // Never honour a custom baseUrl when the apiKey is the operator's platform key.
  const baseUrl = safeBaseUrl("groq", req.apiKey, req.baseUrl) ?? "https://api.groq.com/openai/v1";
  let firstError: unknown;

  for (const model of modelAttempts(req.model, GROQ_FALLBACK_MODELS)) {
    try {
      return await openaiDriver({ ...req, model, baseUrl });
    } catch (err) {
      if (!isModelNotFound(err)) throw err;
      firstError ??= err;
    }
  }
  throw firstError;
};

export default groqDriver;
