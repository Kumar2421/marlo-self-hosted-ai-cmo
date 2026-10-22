/** Why one provider call failed. Drives both the user-facing message and the "stop burning slots" rule. */
export type FailureCode = "auth" | "rate_limit" | "client" | "server" | "timeout" | "network" | "empty" | "unknown";

/** Per-ask time limit. A hung provider costs one slot and at most this long. */
export const ASK_TIMEOUT_MS = 15_000;

/** Codes that will fail the same way on the next prompt, so the method is stopped after two in a row. */
const REPEATING_CODES: ReadonlySet<FailureCode> = new Set(["auth", "rate_limit", "client"]);
export const isRepeatingFailure = (code: FailureCode): boolean => REPEATING_CODES.has(code);

export class GeoProviderError extends Error {
  readonly code: FailureCode;
  readonly status?: number;
  constructor(code: FailureCode, message: string, status?: number) {
    super(message);
    this.name = "GeoProviderError";
    this.code = code;
    this.status = status;
  }
}

export function codeForStatus(status: number): FailureCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return "unknown";
}

export function classifyFailure(err: unknown): { code: FailureCode; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof GeoProviderError) return { code: err.code, message };
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return { code: "timeout", message: "The provider did not answer in time." };
  const http = /HTTP (\d{3})/.exec(message);
  if (http) return { code: codeForStatus(Number(http[1])), message };
  if (/invalid api key|unauthori[sz]ed|incorrect api key/i.test(message)) return { code: "auth", message };
  return { code: "unknown", message };
}

/** Reject if `work` takes longer than `ms`; the late result is ignored. Covers providers that cannot take an AbortSignal. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new GeoProviderError("timeout", "The provider did not answer in time.")), ms);
  });
  work.catch(() => undefined); // a late failure must not become an unhandled rejection
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}
