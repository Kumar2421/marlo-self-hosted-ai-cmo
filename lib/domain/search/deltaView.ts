/**
 * Period-over-period change for the overview cards. Pure.
 *
 * A change against an empty baseline is not a change: a site that had no
 * data in the previous window did not "rise 100%" or "fall 12 places", so
 * these return null and the UI shows no arrow at all.
 */

export type DeltaKind = "count" | "position";

export type Delta = {
  /** Signed raw change, current minus previous (counts: whole numbers; positions: one decimal). */
  change: number;
  /** Size of the move, always >= 0, already rounded for display. */
  magnitude: number;
  /** Whether the number went up or down on the page (positions: "up" means the page moved up the results). */
  direction: "up" | "down" | "flat";
  /** Better or worse for the site. For positions lower is better. */
  tone: "good" | "bad" | "neutral";
};

const present = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** Returns null when there is no usable baseline (zero, missing, or non-finite). */
export function computeDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  kind: DeltaKind = "count",
): Delta | null {
  if (!present(current) || !present(previous)) return null;
  if (previous <= 0) return null;
  // A position of 0 means "no data", not "first place".
  if (kind === "position" && current <= 0) return null;

  if (kind === "position") {
    const moved = Math.round((previous - current) * 10) / 10; // positive = moved up the results
    if (moved === 0) return { change: 0, magnitude: 0, direction: "flat", tone: "neutral" };
    return {
      change: Math.round((current - previous) * 10) / 10,
      magnitude: Math.abs(moved),
      direction: moved > 0 ? "up" : "down",
      tone: moved > 0 ? "good" : "bad",
    };
  }

  const change = Math.round(current - previous);
  if (change === 0) return { change: 0, magnitude: 0, direction: "flat", tone: "neutral" };
  return { change, magnitude: Math.abs(change), direction: change > 0 ? "up" : "down", tone: change > 0 ? "good" : "bad" };
}

export type OverviewDataFlags = {
  /** A snapshot exists but its main 28-day window has no searches yet. */
  collectingData: boolean;
  /** The main window has data but the previous 28 days are empty, so there is nothing to compare with. */
  noComparison: boolean;
};

export function overviewDataFlags(windows: {
  d28: { queries: unknown[] };
  prev28: { queries: unknown[] };
}): OverviewDataFlags {
  const collectingData = windows.d28.queries.length === 0;
  return { collectingData, noComparison: !collectingData && windows.prev28.queries.length === 0 };
}
