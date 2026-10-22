import { buildOpportunities, expectedCtr, type OpportunityGroups, type OpportunityMetrics, type OpportunityType, type SearchOpportunity } from "./searchOpportunities.ts";
import { normalizeQuery } from "./searchIntent.ts";
import type { SearchSnapshotPayload, SnapshotQuery } from "./searchSnapshot.ts";

export const OPPORTUNITY_TYPES: readonly OpportunityType[] = ["ranking", "ctr", "declining", "new_query", "lost_query"];

export function isOpportunityType(value: unknown): value is OpportunityType {
  return typeof value === "string" && (OPPORTUNITY_TYPES as readonly string[]).includes(value);
}

const GROUP_FOR: Record<OpportunityType, keyof Omit<OpportunityGroups, "changes">> = {
  ranking: "ranking",
  ctr: "ctr",
  declining: "declining",
  new_query: "newQueries",
  lost_query: "lostQueries",
};

/** Find the opportunity the user clicked, in the freshly computed groups (never trusting client-sent numbers). */
export function findOpportunity(groups: OpportunityGroups, type: OpportunityType, query: string): SearchOpportunity | null {
  const wanted = normalizeQuery(query);
  return groups[GROUP_FOR[type]].find((o) => normalizeQuery(o.query) === wanted) ?? null;
}

export type OpportunityFindingInput = {
  projectId: string;
  /** The site's brand, for suggested titles. */
  brand: string | null;
  capturedAt: string;
};

export type OpportunityEvidence = {
  query: string;
  opportunity: { type: OpportunityType; reasons: string[]; score: number };
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  previous: OpportunityMetrics | null;
  brand: string | null;
  capturedAt: string;
};

function severityFor(opp: SearchOpportunity): "info" | "warning" | "critical" {
  if (opp.type === "declining" || opp.type === "lost_query") return "warning";
  if (opp.type === "ctr") return opp.metrics.impressions >= 500 ? "warning" : "info";
  return "info";
}

const HEADLINE: Record<OpportunityType, (query: string) => string> = {
  ranking: (q) => `Improve the page that ranks just below page one for “${q}”.`,
  ctr: (q) => `Rewrite the title and description for “${q}” to win more clicks.`,
  declining: (q) => `Find out why you slipped for “${q}” and win the ground back.`,
  new_query: (q) => `Build on the new search “${q}”.`,
  lost_query: (q) => `Find out why “${q}” stopped showing your site.`,
};

/** The Finding to save for an opportunity. Identity is `<type>:<normalized query>`, so the same search can have different issues and re-creating one never duplicates it. */
export function findingForOpportunity(opp: SearchOpportunity, input: OpportunityFindingInput) {
  const evidence: OpportunityEvidence = {
    query: opp.query,
    opportunity: { type: opp.type, reasons: opp.reasons, score: opp.score },
    clicks: opp.metrics.clicks,
    impressions: opp.metrics.impressions,
    ctr: opp.metrics.ctr,
    position: opp.metrics.position,
    previous: opp.previous,
    brand: input.brand,
    capturedAt: input.capturedAt,
  };
  return {
    projectId: input.projectId,
    source: "search-console",
    category: "search-visibility",
    severity: severityFor(opp),
    entityType: "query",
    entityId: `${opp.type}:${normalizeQuery(opp.query)}`,
    url: opp.pageUrl,
    evidence: evidence as unknown as Record<string, unknown>,
    recommendation: HEADLINE[opp.type](opp.query),
  };
}

/** True for findings created from a search opportunity (as opposed to a page-audit rule). */
export function opportunityEvidenceOf(evidence: Record<string, unknown>): OpportunityEvidence | null {
  const opportunity = evidence.opportunity as { type?: unknown } | undefined;
  if (!opportunity || !isOpportunityType(opportunity.type) || typeof evidence.query !== "string") return null;
  return evidence as unknown as OpportunityEvidence;
}

export type OpportunityVerdict = { resolved: boolean; reason: string };

const MIN_VIEWS = 50;
const IMPROVEMENT = 2;

/**
 * Has the problem this finding flagged gone away, judged from the latest
 * snapshot's numbers for the same search? `current` is that search's row in
 * the main window, or null when it no longer appears.
 */
export function evaluateOpportunity(evidence: OpportunityEvidence, current: SnapshotQuery | null): OpportunityVerdict {
  const type = evidence.opportunity.type;

  if (!current) {
    return { resolved: false, reason: "This search has no recent data yet. Refresh your search data and check again." };
  }

  const movedUp = evidence.position - current.position >= IMPROVEMENT;

  switch (type) {
    case "ranking":
      return current.position < 4 || movedUp
        ? { resolved: true, reason: `You now average position ${current.position.toFixed(1)}, up from ${evidence.position.toFixed(1)}.` }
        : { resolved: false, reason: `Still at position ${current.position.toFixed(1)}. It needs to reach the top 3 or move up 2+ places.` };

    case "ctr": {
      const target = expectedCtr(current.position) * 0.5;
      return current.position <= 3.9 && current.ctr >= target
        ? { resolved: true, reason: `Click rate is now ${(current.ctr * 100).toFixed(1)}%.` }
        : { resolved: false, reason: `Click rate is ${(current.ctr * 100).toFixed(1)}%; it should be above ${(target * 100).toFixed(1)}% at this position.` };
    }

    case "declining": {
      const baseline = evidence.previous?.position ?? evidence.position;
      return current.position <= baseline + 1 || movedUp
        ? { resolved: true, reason: `Position recovered to ${current.position.toFixed(1)}.` }
        : { resolved: false, reason: `Still at position ${current.position.toFixed(1)}, down from ${baseline.toFixed(1)}.` };
    }

    case "new_query":
      return movedUp || current.position <= 3.9
        ? { resolved: true, reason: `Moved up to position ${current.position.toFixed(1)}.` }
        : { resolved: false, reason: `Still at position ${current.position.toFixed(1)}.` };

    case "lost_query":
      return current.impressions >= MIN_VIEWS
        ? { resolved: true, reason: `Showing again: ${Math.round(current.impressions).toLocaleString("en-US")} views.` }
        : { resolved: false, reason: "Still barely showing for this search." };
  }
}

// ───────── Helpers the routes use ─────────

export type CreateFromSnapshot =
  | { ok: true; input: ReturnType<typeof findingForOpportunity> }
  | { ok: false; status: number; error: string };

export function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

/**
 * Build the finding for an opportunity the user clicked, from the stored
 * snapshot. The numbers come from the snapshot, never from the client, so
 * evidence cannot be forged and always matches what the panel showed.
 */
export function opportunityFindingFromSnapshot(args: {
  type: OpportunityType;
  query: string;
  payload: SearchSnapshotPayload | null;
  projectId: string;
  brand: string | null;
  projectUrl: string | null;
}): CreateFromSnapshot {
  if (!args.payload) {
    return { ok: false, status: 409, error: "No saved search data yet. Use Refresh now first." };
  }
  const found = findOpportunity(buildOpportunities(args.payload), args.type, args.query);
  if (!found) {
    return { ok: false, status: 409, error: "This opportunity is no longer current. Refresh your search data and try again." };
  }
  // Only keep a page link that belongs to this project's own site.
  const pageUrl = found.pageUrl && args.projectUrl && sameHost(found.pageUrl, args.projectUrl) ? found.pageUrl : null;
  return {
    ok: true,
    input: findingForOpportunity({ ...found, pageUrl }, { projectId: args.projectId, brand: args.brand, capturedAt: args.payload.capturedAt }),
  };
}

/** Search Console data lags: a snapshot must be captured this long after the change to say anything about it. */
export const RECHECK_LAG_DAYS = 3;
export const TOO_EARLY_REASON = "Too early; Google data lags. Check again after the next search data refresh.";

/**
 * Re-check an opportunity finding against the latest snapshot, in the shape the finding service expects.
 *
 * `changedAt` is when the finding was marked fixed. If the latest snapshot was
 * captured less than RECHECK_LAG_DAYS after that, the numbers predate the fix:
 * the result has `tooEarly: true` and callers must NOT change the finding's
 * status (neither verified nor failed).
 */
export function recheckOpportunityFinding(
  finding: { severity: "info" | "warning" | "critical"; recommendation: string; evidence: Record<string, unknown> },
  snapshot: { snapshotDate: string; payload: SearchSnapshotPayload } | null,
  now: Date = new Date(),
  changedAt: string | null = null,
) {
  const changedMs = changedAt ? Date.parse(changedAt) : NaN;
  const capturedMs = snapshot ? Date.parse(snapshot.payload.capturedAt) : NaN;
  const tooEarly =
    Number.isFinite(changedMs) && snapshot !== null && !(capturedMs >= changedMs + RECHECK_LAG_DAYS * 86_400_000);
  const evidence = opportunityEvidenceOf(finding.evidence);
  const wanted = evidence ? normalizeQuery(evidence.query) : "";
  const current = snapshot?.payload.windows.d28.queries.find((q) => normalizeQuery(q.query) === wanted) ?? null;
  const verdict = tooEarly
    ? { resolved: false, reason: TOO_EARLY_REASON }
    : evidence
    ? evaluateOpportunity(evidence, current)
    : { resolved: false, reason: "This finding has no search data to compare." };

  return {
    tooEarly,
    issueDetected: !verdict.resolved,
    severity: finding.severity,
    recommendation: finding.recommendation,
    evidence: {
      ...finding.evidence,
      lastCheck: {
        at: now.toISOString(),
        resolved: verdict.resolved,
        reason: verdict.reason,
        snapshotDate: snapshot?.snapshotDate ?? null,
        current: current ? { impressions: current.impressions, clicks: current.clicks, ctr: current.ctr, position: current.position } : null,
      },
    },
  };
}

type IdentityLike = { source: string; category: string; entityType: string; entityId: string; url: string | null };

/**
 * The finding that already tracks this exact issue, if any. Checked in
 * application code because a database unique key treats two empty page URLs
 * as different, which would otherwise allow (or fail on) a duplicate.
 */
export function findExistingFinding<T extends IdentityLike>(findings: T[], input: IdentityLike): T | null {
  return (
    findings.find(
      (f) =>
        f.source === input.source &&
        f.category === input.category &&
        f.entityType === input.entityType &&
        f.entityId === input.entityId &&
        (f.url ?? null) === (input.url ?? null),
    ) ?? null
  );
}
