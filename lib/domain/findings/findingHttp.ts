import { FindingLifecycleError } from "./findingTypes.ts";

/**
 * Maps an error from the findings routes to an HTTP status and a user-safe
 * sentence. Lifecycle errors are the caller's to fix (400/409); anything else is
 * an upstream or storage failure and never leaks its raw message.
 */
export function findingErrorResponse(err: unknown, fallback = "Could not complete the request. Try again."): { status: number; error: string } {
  if (err instanceof FindingLifecycleError) {
    return { status: err.kind === "rejected" ? 400 : 409, error: err.message };
  }
  return { status: 502, error: fallback };
}
