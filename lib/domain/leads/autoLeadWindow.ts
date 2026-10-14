/**
 * Cooldown for the project-level lead generation route. The free baseline runs
 * once at project creation and then at most once per 24 hours per project, for
 * every caller (owner included), so repeated calls cannot drain the platform's
 * free search budget.
 */
export const AUTO_LEAD_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Milliseconds until a project may generate leads again; 0 when it may run now. */
export function autoLeadCooldownRemainingMs(lastAt: string | null | undefined, nowMs: number, windowMs = AUTO_LEAD_WINDOW_MS): number {
  if (!lastAt) return 0;
  const last = Date.parse(lastAt);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, last + windowMs - nowMs);
}

/** Retry-After value in whole seconds (at least 1 while a cooldown is active). */
export function retryAfterSeconds(remainingMs: number): number {
  return Math.max(1, Math.ceil(remainingMs / 1000));
}
