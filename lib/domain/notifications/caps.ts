import type { NotificationKind } from "./types.ts";

const DAY_MS = 86_400_000;

/** Monday (as "YYYY-MM-DD") of the week containing the given local date. */
export function weekStartOf(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7; // days since Monday
  return new Date(d.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

/** One weekly digest per week. */
export const digestKey = (isoDate: string) => `weekly_digest:${weekStartOf(isoDate)}`;
/** One digest per day, for people who choose a daily digest. */
export const dailyDigestKey = (isoDate: string) => `daily_digest:${isoDate}`;
/** One per finished measurement, ever. */
export const outcomeKey = (actionId: string) => `outcome_measured:${actionId}`;
/** One credits warning per threshold (percent left: 20 or 0) per calendar month. */
export const creditsKey = (threshold: 20 | 0, now: Date) => `credits_low:${threshold}:${now.toISOString().slice(0, 7)}`;
/** One per integration per 3-day window. */
export const integrationKey = (integration: string, now: Date) => `integration_disconnected:${integration}:${Math.floor(now.getTime() / (3 * DAY_MS))}`;
/** At most one approvals reminder per day. */
export const approvalsKey = (isoDate: string) => `approval_needed:${isoDate}`;
/** At most one "new social drafts" item per user per day (the daily drafts job may run for several projects). */
export const socialDraftsKey = (userId: string, isoDate: string) => `social_drafts_ready:${userId}:${isoDate}`;
/** At most one "daily drafts paused: out of credits" item per user per day. */
export const socialDraftsPausedKey = (userId: string, isoDate: string) => `social_drafts_paused:${userId}:${isoDate}`;

/** Max individual emails per kind in any 24 hours. Kinds not listed are limited by their dedupe key alone. */
export const EMAIL_DAILY_CAPS: Partial<Record<NotificationKind, number>> = { outcome_measured: 1, approval_needed: 1 };

export function withinEmailCap(kind: NotificationKind, sentInLast24h: number): boolean {
  const cap = EMAIL_DAILY_CAPS[kind];
  return cap === undefined || sentInLast24h < cap;
}

/** Credits warning level: 0 when empty, 20 when at or under a fifth of what was granted, otherwise none. */
export function creditsThreshold(balance: number, granted: number): 20 | 0 | null {
  if (balance <= 0) return 0;
  if (granted > 0 && balance / granted <= 0.2) return 20;
  return null;
}

/** A measured fix is a big win when it is a solid, improved verdict (the same bar the outcome card uses). */
export function isBigWin(outcome: { status: string; confidence: string | null }): boolean {
  return outcome.status === "improved" && outcome.confidence === "solid";
}

/** Keep only drafts whose key is not stored yet, nor repeated earlier in this same batch. */
export function dropDuplicates<T extends { dedupeKey: string }>(drafts: T[], existing: Set<string>): T[] {
  const seen = new Set(existing);
  return drafts.filter((d) => {
    if (seen.has(d.dedupeKey)) return false;
    seen.add(d.dedupeKey);
    return true;
  });
}
