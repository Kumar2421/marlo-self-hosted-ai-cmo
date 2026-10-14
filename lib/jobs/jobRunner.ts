import crypto from "node:crypto";

export type JobRunSummary<T> = {
  processed: number;
  /** Items left untouched because the time budget ran out; they are retried on the next run. */
  skipped: number;
  failed: Array<{ item: T; error: string }>;
};

/**
 * Run `handler` over `items` one at a time until the time budget is spent.
 * One failing item never stops the rest. Serverless cron invocations have a
 * hard timeout, so stopping early and resuming next run beats being killed
 * mid-item.
 */
export async function runWithBudget<T>(
  items: T[],
  handler: (item: T) => Promise<void>,
  options: { budgetMs: number; now?: () => number },
): Promise<JobRunSummary<T>> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.budgetMs;
  const summary: JobRunSummary<T> = { processed: 0, skipped: 0, failed: [] };

  for (let index = 0; index < items.length; index += 1) {
    if (now() >= deadline) {
      summary.skipped = items.length - index;
      break;
    }
    try {
      await handler(items[index]);
      summary.processed += 1;
    } catch (err) {
      summary.failed.push({ item: items[index], error: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. An unset, empty or
 * literal "undefined" secret must never authorize anything (a naive
 * `=== \`Bearer ${secret}\`` check would accept "Bearer undefined" when the
 * env var is missing). Both sides are reduced to SHA-256 digests so the
 * comparison is fixed-length and constant-time.
 */
export function isAuthorizedCron(authorizationHeader: string | null, secret: string | undefined): boolean {
  if (!authorizationHeader || !secret) return false;
  const trimmed = secret.trim();
  if (trimmed === "" || trimmed === "undefined" || trimmed === "null") return false;
  const expected = crypto.createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  const actual = crypto.createHash("sha256").update(authorizationHeader, "utf8").digest();
  return crypto.timingSafeEqual(expected, actual);
}
