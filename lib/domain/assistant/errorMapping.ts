/** SDK errors are verbose (raw JSON bodies, stack-ish text) — trim to something a chat bubble can show. */
export function friendlyProviderError(providerId: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (/authentication|invalid.*api.?key|401/i.test(raw)) {
    return `${providerId}: API key was rejected. Check it in Settings → LLM Providers.`;
  }
  if (/rate.?limit|429/i.test(raw)) {
    return `${providerId}: rate limited — wait a moment and try again.`;
  }
  if (/model.*(not found|does not exist)|404/i.test(raw)) {
    return `${providerId}: that model isn't available on this account.`;
  }

  return `${providerId} request failed. Try again in a moment.`;
}

export type ProviderErrorKind =
  | "auth" | "rate_limit" | "model_unavailable" | "server" | "timeout" | "network" | "bad_request" | "unknown";

export type ProviderErrorClass = {
  kind: ProviderErrorKind;
  /** True when the same request may succeed if simply tried again (transient). */
  retryable: boolean;
};

const RETRYABLE: Record<ProviderErrorKind, boolean> = {
  auth: false, rate_limit: true, model_unavailable: false, server: true,
  timeout: true, network: true, bad_request: false, unknown: false,
};

function statusOf(err: unknown): number | null {
  const s = err as { status?: unknown; statusCode?: unknown } | null;
  if (typeof s?.status === "number") return s.status;
  if (typeof s?.statusCode === "number") return s.statusCode;
  return null;
}

function kindFromStatus(status: number): ProviderErrorKind | null {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model_unavailable";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500 && status <= 599) return "server";
  if (status >= 400 && status <= 499) return "bad_request";
  return null;
}

/**
 * Pure classification of a provider failure, for the future fallback policy.
 * An HTTP status on the error wins; otherwise the message text decides.
 */
export function classifyProviderError(err: unknown): ProviderErrorClass {
  const status = statusOf(err);
  let kind: ProviderErrorKind | null = status === null ? null : kindFromStatus(status);

  if (!kind) {
    const raw = err instanceof Error ? err.message : String(err);
    if (/authentication|invalid.*api.?key|unauthori[sz]ed|forbidden|\b40[13]\b/i.test(raw)) kind = "auth";
    else if (/rate.?limit|too many requests|quota|\b429\b/i.test(raw)) kind = "rate_limit";
    else if (/model.*(not found|does not exist)|\b404\b/i.test(raw)) kind = "model_unavailable";
    else if (/timed? ?out|timeout|ETIMEDOUT|aborted|\b408\b/i.test(raw)) kind = "timeout";
    else if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket hang up/i.test(raw)) kind = "network";
    else if (/overloaded|internal server error|bad gateway|service unavailable|\b5\d\d\b/i.test(raw)) kind = "server";
    else if (/bad request|invalid request|\b400\b|\b422\b/i.test(raw)) kind = "bad_request";
    else kind = "unknown";
  }
  return { kind, retryable: RETRYABLE[kind] };
}
