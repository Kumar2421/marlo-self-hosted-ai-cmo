export type DataFreshness = "fresh" | "stale" | "very_stale";

const DAY_MS = 86_400_000;

function utcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole UTC days between a snapshot date (YYYY-MM-DD or ISO) and now, or null when unparsable. */
export function snapshotAgeDays(snapshotDate: string, now: Date): number | null {
  const snap = Date.parse(snapshotDate.length === 10 ? `${snapshotDate}T00:00:00Z` : snapshotDate);
  if (Number.isNaN(snap)) return null;
  return Math.max(0, Math.round((utcDay(now.getTime()) - utcDay(snap)) / DAY_MS));
}

/** fresh: up to `staleAfterDays` old; stale: older; very_stale: `veryStaleAfterDays` or more, or unreadable. */
export function dataFreshness(snapshotDate: string, now: Date, staleAfterDays = 2, veryStaleAfterDays = 7): DataFreshness {
  const age = snapshotAgeDays(snapshotDate, now);
  if (age === null || age >= veryStaleAfterDays) return "very_stale";
  return age > staleAfterDays ? "stale" : "fresh";
}
