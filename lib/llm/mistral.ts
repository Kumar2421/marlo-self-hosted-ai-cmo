import type { LlmDriver } from "./types";
import openaiDriver from "./openai";
import { safeBaseUrl } from "./platformKeys";

/** Mistral's La Plateforme API exposes an OpenAI-compatible chat completions
 * endpoint at api.mistral.ai/v1 — same reasoning as groq.ts: reuse the OpenAI
 * driver, just pin the right default base URL when the caller didn't supply
 * one (the platform-provided-key path — see lib/llm/platformKeys.ts). */
const mistralDriver: LlmDriver = (req) =>
  openaiDriver({ ...req, baseUrl: safeBaseUrl("mistral", req.apiKey, req.baseUrl) ?? "https://api.mistral.ai/v1" });

export default mistralDriver;
