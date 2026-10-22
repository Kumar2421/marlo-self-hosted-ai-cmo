/**
 * Rank the most impactful actions the user should take next.
 * Pure logic: no IO, no jargon, plain language for cards.
 */

import type { Finding } from "../findings/findingTypes.ts";

export type NextActionCard = {
  title: string;
  why: string;
  expectedImpact: string;
  findingId?: string;
};

/**
 * Turn findings and opportunities into a ranked list of next actions.
 * Skip findings already marked Fixed, return plain-language cards.
 * @param findings All findings for the project
 * @param opportunities The computed opportunity groups
 * @param limit Max cards to return (default 3)
 */
export function rankNextActions(
  findings: Finding[],
  opportunities: {
    ranking: Array<{ query: string; metrics: { impressions: number; position: number } }>;
    ctr: Array<{ query: string; metrics: { impressions: number; position: number } }>;
    declining: Array<{ query: string; metrics: { impressions: number } }>;
    newQueries: Array<{ query: string; metrics: { impressions: number } }>;
    lostQueries: Array<{ query: string; metrics: { impressions: number } }>;
  },
  limit: number = 3,
): NextActionCard[] {
  const actions: NextActionCard[] = [];

  // A finding that is already fixed or verified is done: no card, and the next candidate takes its place.
  const findingFor = (prefix: string, query: string) => findings.find((f) => f.entityId === `${prefix}:${normalizeQuery(query)}`);
  const isDone = (f: Finding | undefined) => f !== undefined && ["fixed", "verified"].includes(f.status);
  const open = <T extends { query: string }>(prefix: string, list: T[]) => list.filter((o) => !isDone(findingFor(prefix, o.query)));

  // 1. Improve highest-impact ranking opportunities
  for (const opp of open("ranking", opportunities.ranking).slice(0, 2)) {
    const finding = findingFor("ranking", opp.query);
    const impressions = Math.round(opp.metrics.impressions);
    actions.push({
      title: `Improve page for "${opp.query}"`,
      why: `This search showed your site ${impressions.toLocaleString("en-US")} times in the last 28 days, but your page ranks just outside the top results.`,
      expectedImpact: `Right now: ${describeToday(opp.metrics)}. We don't forecast clicks.`,
      ...(finding ? { findingId: finding.id } : {}),
    });
  }

  // 2. Rewrite titles/descriptions for CTR opportunities
  for (const opp of open("ctr", opportunities.ctr).slice(0, 1)) {
    const finding = findingFor("ctr", opp.query);
    const impressions = Math.round(opp.metrics.impressions);
    actions.push({
      title: `Rewrite snippet for "${opp.query}"`,
      why: `This search showed your site ${impressions.toLocaleString("en-US")} times in the last 28 days, but your click rate is unusually low for its position.`,
      expectedImpact: `Right now: ${describeToday(opp.metrics)}. We don't forecast clicks.`,
      ...(finding ? { findingId: finding.id } : {}),
    });
  }

  // 3. Investigate declining searches
  for (const opp of open("declining", opportunities.declining).slice(0, 1)) {
    const finding = findingFor("declining", opp.query);
    actions.push({
      title: `Recover position for "${opp.query}"`,
      why: `You lost ground on this search. It used to bring more traffic.`,
      expectedImpact: `Re-check this search after the fix to see whether your position came back.`,
      ...(finding ? { findingId: finding.id } : {}),
    });
  }

  return actions.slice(0, limit);
}

type Metrics = { impressions: number; position?: number; clicks?: number };

/** Measured numbers only, never a prediction. */
function describeToday(m: Metrics): string {
  const parts = [`${Math.round(m.impressions).toLocaleString("en-US")} views`];
  if (typeof m.clicks === "number") parts.unshift(`${Math.round(m.clicks).toLocaleString("en-US")} clicks`);
  const base = parts.join(" from ");
  return typeof m.position === "number" && m.position > 0 ? `${base} at average position ${m.position.toFixed(1)}` : base;
}

/** Enough search data to say anything: at least one search with this many views in the main window. */
export const MIN_VIEWS_FOR_OPPORTUNITIES = 100;

export type NextActionsEmptyState =
  | { kind: "not_enough_data"; message: string }
  | { kind: "nothing_to_fix"; message: string };

/**
 * What to show when there are no next-action cards. The green "nothing to fix"
 * state is only honest when the site has enough data for the rules to have
 * had a chance to fire (searches with 100+ views); otherwise say so.
 */
export function nextActionsEmptyState(
  snapshot: { windows: { d28: { queries: Array<{ impressions: number }> } } } | null | undefined,
): NextActionsEmptyState {
  const enough = snapshot?.windows.d28.queries.some((q) => q.impressions >= MIN_VIEWS_FOR_OPPORTUNITIES) ?? false;
  return enough
    ? { kind: "nothing_to_fix", message: "Nothing to fix right now. Nothing in your search data needs attention." }
    : {
        kind: "not_enough_data",
        message: `Not enough search data yet to find opportunities. We need searches with ${MIN_VIEWS_FOR_OPPORTUNITIES}+ views in the last 28 days.`,
      };
}

/** Normalize a query for consistent matching (lowercase, no extra whitespace). */
function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}
