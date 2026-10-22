import { ApiError } from "./fetchJson.ts";

/** Client errors (not connected, not found, not allowed) won't fix themselves; only retry flaky failures. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  // Already waited out the full timeout: retrying would triple the wait before the user sees an error.
  if (error instanceof ApiError && error.timedOut) return false;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return true;
}
