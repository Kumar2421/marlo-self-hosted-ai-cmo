/**
 * Relative day labels ("today", "yesterday", "3 days ago") by calendar day, not by elapsed hours:
 * a timestamp from 11pm last night is "yesterday" at 9am, even though under 24 hours have passed.
 * Pure: `now` and `timeZone` are injected (timeZone defaults to the viewer's own).
 */

function dayNumber(date: Date, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000);
}

/** Whole calendar days from `then` to `now` in the zone (0 = same day, negative = in the future). */
export function calendarDaysAgo(then: Date, now: Date, timeZone?: string): number {
  return dayNumber(now, timeZone) - dayNumber(then, timeZone);
}

/** "today", "yesterday", "N days ago"; a future time counts as "today". */
export function relativeDayLabel(then: Date, now: Date, timeZone?: string): string {
  const days = calendarDaysAgo(then, now, timeZone);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** "Oct 22, 2026" in the zone's calendar. */
export function shortDateLabel(date: Date, timeZone?: string): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
}
