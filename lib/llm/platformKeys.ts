/**
 * Server-only, closed-source: platform-provided free-tier keys, set once as
 * real Vercel/host env vars by the operator (never present in
 * .env.opensource — self-host users always BYOK, see lib/features.ts).
 *
 * Single source of truth — every agent/document generation route and the
 * LLM Providers settings UI (via /api/providers) read this same map instead
 * of each keeping its own duplicate copy, so adding/removing a platform key
 * only has to happen in one place.
 */
export const PLATFORM_PROVIDER_KEYS: Record<string, string | undefined> = {
  groq: process.env.GROQ_API_KEY,
  mistral: process.env.MISTRAL_API_KEY,
};

/** SECURITY (defense in depth for the drivers): the operator's platform key
 * may only ever be sent to the provider's own default endpoint. Returns the
 * request's baseUrl, or undefined when the key being used is the platform key
 * (so a stray user base URL can never receive it). */
export function safeBaseUrl(providerId: string, apiKey: string, baseUrl: string | undefined): string | undefined {
  const platform = PLATFORM_PROVIDER_KEYS[providerId];
  if (platform && apiKey === platform) return undefined;
  return baseUrl;
}

/** Default model per platform-managed provider — same map /api/providers
 * uses to auto-assign a new hosted user's primaryModel, and what the free
 * auto lead-generation feature pins to (it always uses the platform's own
 * key, never a user's BYOK connection, so it needs one fixed model here). */
export const PLATFORM_DEFAULT_MODELS: Record<string, string> = {
  groq: "openai/gpt-oss-120b",
  mistral: "mistral-large-latest",
};

/** True when the platform operator has configured a real key for this
 * provider — safe to expose to the client as a boolean (never the key
 * itself). Used to show "Included with your plan" instead of a BYOK form. */
export function hasPlatformKey(providerId: string): boolean {
  return Boolean(PLATFORM_PROVIDER_KEYS[providerId]);
}

/** The operator's platform key for a provider, or undefined. Prefer
 * resolveLlmCredential for anything that calls an LLM — it keeps a user's
 * custom base URL away from this key. Only for keys used with the provider's
 * own default endpoint (never with a user-supplied URL). */
export function platformKeyFor(providerId: string): string | undefined {
  return PLATFORM_PROVIDER_KEYS[providerId] || undefined;
}

export type LlmCredential =
  | { source: "byok"; apiKey: string; baseUrl: string | undefined }
  | { source: "platform"; apiKey: string; baseUrl: undefined }
  | { source: "none"; apiKey: ""; baseUrl: undefined };

/**
 * SECURITY: single place that decides which key + base URL an LLM call uses.
 *
 * - The user's own BYOK key (non-empty) wins, and only then is their custom
 *   base URL honoured (it is their own key going to their own endpoint).
 * - Otherwise the operator's platform key is used and baseUrl is ALWAYS
 *   undefined. A user-controlled base URL must never be paired with the
 *   operator's key, or the key would be sent to an attacker's server in the
 *   Authorization header.
 */
export function resolveLlmCredential(input: {
  providerId: string;
  byokKey?: string | null;
  byokBaseUrl?: string | null;
}): LlmCredential {
  const byok = input.byokKey?.trim() ? input.byokKey : "";
  if (byok) {
    return { source: "byok", apiKey: byok, baseUrl: input.byokBaseUrl || undefined };
  }
  const platform = platformKeyFor(input.providerId);
  if (platform) return { source: "platform", apiKey: platform, baseUrl: undefined };
  return { source: "none", apiKey: "", baseUrl: undefined };
}

/**
 * Hosted-mode validation for POST /api/providers. Returns an error message,
 * or null when OK. A base URL without a new API key is refused for providers
 * that have a platform key (operator-key exfiltration), and whenever a
 * base URL is saved without a new key an existing stored secret must not be
 * kept (caller nulls api_key_secret_id) so an old key is never paired with a
 * new URL.
 */
export function validateHostedProviderSave(input: {
  providerId: string;
  apiKey: string;
  baseUrl: string | null;
}): string | null {
  const hasKey = Boolean(input.apiKey.trim());
  if (input.baseUrl && !hasKey && input.providerId in PLATFORM_PROVIDER_KEYS) {
    return `A custom base URL for ${input.providerId} requires your own API key. Provide an API key, or leave the base URL empty to use the included plan.`;
  }
  return null;
}
