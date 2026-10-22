/** A failed API call, keeping the HTTP status so callers can tell "not connected" (4xx) from "server broke" (5xx). */
export class ApiError extends Error {
  readonly status: number;
  /** True when the request was abandoned because the server never answered in time. */
  readonly timedOut: boolean;

  constructor(message: string, status: number, timedOut = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.timedOut = timedOut;
  }
}

/** How long a read may take before the panel shows an error with Retry instead of an endless skeleton. */
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export type FetchOptions = RequestInit & {
  /** Overrides the timeout. Reads default to 20s; writes default to none (they can legitimately run long, e.g. LLM calls). */
  timeoutMs?: number;
};

/** The timeout that applies when the caller did not pass one: bounded for reads, unbounded for writes. */
export function defaultTimeoutMs(method: string | undefined): number | null {
  return !method || method.toUpperCase() === "GET" ? DEFAULT_FETCH_TIMEOUT_MS : null;
}

/**
 * fetch that gives up after `timeoutMs` and throws ApiError (status 0, timedOut) instead of hanging.
 * A caller-supplied `signal` still cancels the request, and its abort is rethrown untouched.
 */
export async function fetchWithTimeout(url: string, init: FetchOptions = {}): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init;
  const limit = timeoutMs ?? defaultTimeoutMs(rest.method);
  const timeout = limit === null ? null : AbortSignal.timeout(limit);
  const combined = timeout && signal ? AbortSignal.any([timeout, signal]) : (timeout ?? signal ?? undefined);
  try {
    return await fetch(url, { cache: "no-store", ...rest, signal: combined });
  } catch (err) {
    if (timeout?.aborted && !signal?.aborted) {
      throw new ApiError("This is taking too long. Check your connection and try again.", 0, true);
    }
    if (signal?.aborted) throw err;
    throw new ApiError("Network error. Check your connection and try again.", 0);
  }
}

/**
 * fetch + JSON with real error handling. Throws ApiError carrying the server's
 * `{ error }` message instead of silently returning nothing, so a failed load
 * is visible to the UI (and to retry logic) rather than looking like "no data".
 */
export async function fetchJson<T>(url: string, init?: FetchOptions): Promise<T> {
  const response = await fetchWithTimeout(url, init);
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new ApiError(payload?.error ?? `Request failed (${response.status})`, response.status);
  }
  return payload as T;
}
