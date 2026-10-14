/**
 * Hard limits for background audits (cron verify and monitor). An SEO audit
 * cannot be aborted once started, so every background call is raced against a
 * timer and a call is never started without the time for its full timeout.
 */

/** Longest a single background audit may take. */
export const BACKGROUND_AUDIT_TIMEOUT_MS = 9_000;
/** A background audit only starts when at least this much phase budget is left. */
export const MIN_AUDIT_BUDGET_MS = 9_000;

export type TimedResult<T> = { ok: true; value: T } | { ok: false; reason: "timeout" | "error" };

/**
 * Runs `work` and resolves with its value, or with a typed failure when it
 * throws or does not settle within `ms`. Never rejects. The abandoned work is
 * not cancelled; its own network timeouts end it.
 */
export function timedCall<T>(work: () => Promise<T>, ms: number): Promise<TimedResult<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), Math.max(0, ms));
    Promise.resolve()
      .then(work)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve({ ok: true, value });
        },
        () => {
          clearTimeout(timer);
          resolve({ ok: false, reason: "error" });
        },
      );
  });
}
