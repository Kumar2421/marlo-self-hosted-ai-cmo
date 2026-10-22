import { ApiError } from "./query/fetchJson.ts";

/**
 * Text that is safe to show a user for a caught error. Typed ApiError messages are
 * already written for users (the server's `{ error }` or a fixed network sentence);
 * anything else (TypeError "Cannot read properties of null", etc.) is a technical
 * detail, so callers get the plain fallback and keep the original in console.error.
 */
export function plainError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message.trim()) return err.message;
  return fallback;
}
