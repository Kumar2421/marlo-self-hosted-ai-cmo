import type { ActionType } from "../actions/actionTypes.ts";
import { opportunityEvidenceOf, type OpportunityEvidence } from "./opportunityFinding.ts";
import { compareFingerprints, type FingerprintChange, type PageFingerprint } from "./pageFingerprint.ts";
import { normalizeQuery } from "./searchIntent.ts";
import type { SearchSnapshotPayload, SnapshotQuery } from "./searchSnapshot.ts";

/**
 * "Did my fix work?" Everything here measures from ONE moment: when the change
 * went live (`implementedAt`). It does not care how the change got there, so
 * the same readout works whether the user edited their site by hand today,
 * or a merged GitHub pull request (or a CMS publish) set `implementedAt`
 * tomorrow. Only `via` and the optional `change` proof differ.
 */
export type ImplementationVia = "manual" | "github_pr" | "cms_publish";

export type OutcomeBaseline = {
  capturedAt: string;
  snapshotDate: string | null;
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  /** Where the numbers came from: the saved snapshot at that moment, or the evidence the finding was created with.
   *  "latest_snapshot": the merge was noticed late and no snapshot from before it existed, so the newest one was used. */
  source: "snapshot" | "finding" | "latest_snapshot";
  /** True when the baseline may already include post-change data (see "latest_snapshot"). Verdicts on it are never saved as final. */
  approximate?: boolean;
};

export type ImplementationRecord = {
  via: ImplementationVia;
  implementedAt: string;
  /** Null for fixes that have no search numbers to compare (nothing to measure yet). */
  baseline: OutcomeBaseline | null;
  /** Proof of what changed, filled by integrations (a merged PR's link and summary). */
  change?: { prUrl?: string; summary?: string };
  /** The page that was edited; its fingerprint is compared before and after. */
  pageUrl?: string;
  /** The page's title, description and main heading when the change was reported. */
  pageBefore?: PageFingerprint | null;
  /** The same, captured the first time the outcome is read after the minimum wait. */
  pageAfter?: PageFingerprint | null;
};

const metricsOf = (q: SnapshotQuery) => ({ impressions: q.impressions, clicks: q.clicks, ctr: q.ctr, position: q.position });

/** This search's row in the main 28-day window of a snapshot, if it is there. */
export function currentRowFor(query: string, payload: SearchSnapshotPayload | null | undefined): SnapshotQuery | null {
  const wanted = normalizeQuery(query);
  return payload?.windows.d28.queries.find((q) => normalizeQuery(q.query) === wanted) ?? null;
}

/**
 * The numbers to compare against later. Prefers the latest snapshot (the state
 * right when the change was made); falls back to what the finding was
 * flagged with, so a baseline always exists for a search-opportunity finding.
 */
export function baselineFor(
  evidence: OpportunityEvidence,
  snapshot: { snapshotDate: string; payload: SearchSnapshotPayload } | null,
  now: Date,
  /** The snapshot used is newer than the change (the change was noticed late): flag the baseline as approximate. */
  approximate = false,
): OutcomeBaseline {
  const row = currentRowFor(evidence.query, snapshot?.payload);
  if (row) {
    if (approximate) {
      return { capturedAt: now.toISOString(), snapshotDate: snapshot?.snapshotDate ?? null, query: evidence.query, ...metricsOf(row), source: "latest_snapshot", approximate: true };
    }
    return { capturedAt: now.toISOString(), snapshotDate: snapshot?.snapshotDate ?? null, query: evidence.query, ...metricsOf(row), source: "snapshot" };
  }
  return {
    capturedAt: now.toISOString(),
    snapshotDate: null,
    query: evidence.query,
    impressions: evidence.impressions,
    clicks: evidence.clicks,
    ctr: evidence.ctr,
    position: evidence.position,
    source: "finding",
  };
}

/** The record saved when the user (or an integration) reports the change is live. */
export function buildImplementation(args: {
  finding: { evidence: Record<string, unknown> };
  snapshot: { snapshotDate: string; payload: SearchSnapshotPayload } | null;
  via?: ImplementationVia;
  now?: Date;
  change?: ImplementationRecord["change"];
  pageUrl?: string | null;
  pageBefore?: PageFingerprint | null;
  /** The snapshot may be newer than the change (see baselineFor). */
  approximateBaseline?: boolean;
}): ImplementationRecord {
  const now = args.now ?? new Date();
  const evidence = opportunityEvidenceOf(args.finding.evidence);
  return {
    via: args.via ?? "manual",
    implementedAt: now.toISOString(),
    baseline: evidence ? baselineFor(evidence, args.snapshot, now, args.approximateBaseline === true) : null,
    ...(args.change ? { change: args.change } : {}),
    ...(args.pageUrl ? { pageUrl: args.pageUrl } : {}),
    ...(args.pageBefore ? { pageBefore: args.pageBefore } : {}),
  };
}

function fingerprintOf(value: unknown): PageFingerprint | null {
  const v = value as Partial<PageFingerprint> | null | undefined;
  return v && typeof v.title === "string" && typeof v.description === "string" && typeof v.h1 === "string" ? { title: v.title, description: v.description, h1: v.h1 } : null;
}

/** Read the saved record back out of an action's `result`, ignoring anything malformed. */
export function implementationOf(result: Record<string, unknown> | null | undefined): ImplementationRecord | null {
  const raw = result?.implementation as Partial<ImplementationRecord> | undefined;
  if (!raw || typeof raw.implementedAt !== "string" || Number.isNaN(Date.parse(raw.implementedAt))) return null;
  const via: ImplementationVia = raw.via === "github_pr" || raw.via === "cms_publish" ? raw.via : "manual";
  const b = raw.baseline as Partial<OutcomeBaseline> | null | undefined;
  const baseline: OutcomeBaseline | null =
    b && typeof b.query === "string" && [b.impressions, b.clicks, b.ctr, b.position].every((n) => typeof n === "number")
      ? (b as OutcomeBaseline)
      : null;
  const pageBefore = fingerprintOf(raw.pageBefore);
  const pageAfter = fingerprintOf(raw.pageAfter);
  return {
    via,
    implementedAt: raw.implementedAt,
    baseline,
    ...(raw.change ? { change: raw.change } : {}),
    ...(typeof raw.pageUrl === "string" && raw.pageUrl ? { pageUrl: raw.pageUrl } : {}),
    ...(pageBefore ? { pageBefore } : {}),
    ...(pageAfter ? { pageAfter } : {}),
  };
}

// ───────── Evaluation ─────────

/** Google needs time to re-crawl, and Search Console lags ~3 days: nothing is judged before this. */
export const MIN_DAYS = 7;
/** From here the verdict is "solid"; before it, it is an early signal. */
export const SOLID_DAYS = 14;
/** Below this many views before the change, movement is mostly noise. */
export const MIN_BASELINE_IMPRESSIONS = 100;
const POSITION_MOVE = 1;
const RELATIVE_MOVE = 0.2;
const CLICKS_MOVE = 0.25;

/** "not_applied": a snippet rewrite whose page title, description and heading look exactly as before. */
export type OutcomeStatus = "waiting" | "improved" | "unchanged" | "regressed" | "no_data" | "not_applied";

export type Outcome = {
  status: OutcomeStatus;
  daysSince: number;
  /** Days until a verdict is possible (only while waiting). */
  daysUntilReady: number;
  confidence: "early" | "solid" | null;
  headline: string;
  /** What the page check found, shown beside the verdict. */
  pageNote: string | null;
  baseline: OutcomeBaseline | null;
  current: { impressions: number; clicks: number; ctr: number; position: number } | null;
  via: ImplementationVia;
};

type Metric = "ctr" | "position";
const metricFor = (type: ActionType): Metric => (type === "rewrite_snippet" ? "ctr" : "position");

const DAY = 86_400_000;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const relative = (now: number, before: number) => (before > 0 ? (now - before) / before : now > 0 ? 1 : 0);

const quote = (text: string) => (text ? `“${text.length > 70 ? `${text.slice(0, 67)}…` : text}”` : "empty");
const FIELD = { title: "title", description: "description", h1: "main heading" } as const;

function pageNoteFor(change: FingerprintChange | null | undefined, type: ActionType): string | null {
  if (!change) return null;
  if (change.changed) {
    const first = change.changes[0];
    const more = change.changes.length > 1 ? ` (+${change.changes.length - 1} more)` : "";
    return `Change found: ${FIELD[first.field]} was ${quote(first.before)}, now ${quote(first.after)}${more}.`;
  }
  return type === "rewrite_snippet"
    ? null
    : "No change found in the page title, description or main heading. Ignore this if you edited other content.";
}

/** The verdict for one implemented change, from the numbers now vs the baseline. Pure. */
export function evaluateOutcome(args: {
  implementation: ImplementationRecord;
  actionType: ActionType;
  current: SnapshotQuery | null;
  now?: Date;
  /** Before/after page comparison, when both fingerprints exist. */
  pageChange?: FingerprintChange | null;
}): Outcome {
  const { implementation, current } = args;
  const now = args.now ?? new Date();
  const daysSince = Math.max(0, Math.floor((now.getTime() - Date.parse(implementation.implementedAt)) / DAY));
  const base = {
    daysSince,
    daysUntilReady: Math.max(0, MIN_DAYS - daysSince),
    baseline: implementation.baseline,
    current: current ? metricsOf(current) : null,
    via: implementation.via,
    pageNote: pageNoteFor(args.pageChange, args.actionType),
  };
  const approximateNote = implementation.baseline?.approximate ? " The baseline is approximate because the merge was noticed late." : "";
  const done = (status: OutcomeStatus, headline: string, confidence: Outcome["confidence"] = null): Outcome => ({
    status,
    confidence,
    headline: `${headline}${approximateNote}`,
    ...base,
  });

  const baseline = implementation.baseline;
  // A snippet rewrite edits the title/description, so an identical page means it never went live.
  if (daysSince >= MIN_DAYS && args.actionType === "rewrite_snippet" && args.pageChange && !args.pageChange.changed) {
    return done(
      "not_applied",
      "We couldn't see a change to the page title, description or main heading since you marked it done. Check that the edit went live.",
    );
  }

  if (!baseline) return done("no_data", "This kind of fix isn't measured from search data yet. Mark it done and review it yourself.");

  if (daysSince < MIN_DAYS) {
    const left = MIN_DAYS - daysSince;
    return done("waiting", `Too early to tell. Google needs time to notice the change. Check back in ${left} day${left === 1 ? "" : "s"}.`);
  }
  if (baseline.impressions < MIN_BASELINE_IMPRESSIONS) {
    return done("no_data", `Only ${Math.round(baseline.impressions)} views before the change, which is too few to measure reliably.`);
  }
  if (!current) return done("no_data", "No recent data for this search yet. Refresh your search data and check again.");

  const confidence = daysSince >= SOLID_DAYS ? "solid" : "early";
  const suffix = ` after ${daysSince} days${confidence === "early" ? " (early signal)" : ""}`;
  const positionChange = current.position - baseline.position;
  const impressionsChange = relative(current.impressions, baseline.impressions);

  if (metricFor(args.actionType) === "ctr") {
    const ctrChange = relative(current.ctr, baseline.ctr);
    const text = `Click rate ${pct(baseline.ctr)} → ${pct(current.ctr)}`;
    if (ctrChange >= RELATIVE_MOVE && impressionsChange >= -0.3) return done("improved", `Improved: ${text}${suffix}.`, confidence);
    if (ctrChange <= -RELATIVE_MOVE) return done("regressed", `Got worse: ${text}${suffix}.`, confidence);
    return done("unchanged", `No clear change: ${text}${suffix}.`, confidence);
  }

  const posText = `position ${baseline.position.toFixed(1)} → ${current.position.toFixed(1)}`;
  if (positionChange <= -POSITION_MOVE && impressionsChange >= -0.5) return done("improved", `Improved: ${posText}${suffix}.`, confidence);
  if (positionChange >= POSITION_MOVE) return done("regressed", `Got worse: ${posText}${suffix}.`, confidence);

  const clicksChange = relative(current.clicks, baseline.clicks);
  if (clicksChange >= CLICKS_MOVE && impressionsChange >= -0.3) {
    return done("improved", `Improved: clicks up ${Math.round(clicksChange * 100)}% at about the same position${suffix}.`, confidence);
  }
  if (clicksChange <= -CLICKS_MOVE) {
    return done("regressed", `Got worse: clicks down ${Math.round(-clicksChange * 100)}% at about the same position${suffix}.`, confidence);
  }
  return done("unchanged", `No clear change: ${posText}${suffix}.`, confidence);
}

/** The outcome to show for an action, or null if it was never marked implemented. */
export function outcomeForAction(args: {
  action: { type: ActionType; result: Record<string, unknown> | null };
  finding: { evidence: Record<string, unknown> } | null;
  snapshot: { snapshotDate: string; payload: SearchSnapshotPayload } | null;
  now?: Date;
}): Outcome | null {
  const implementation = implementationOf(args.action.result);
  if (!implementation) return null;
  const saved = savedOutcomeOf(args.action.result);
  if (saved) return saved;
  const evidence = args.finding ? opportunityEvidenceOf(args.finding.evidence) : null;
  const query = implementation.baseline?.query ?? evidence?.query ?? "";
  return evaluateOutcome({
    implementation,
    actionType: args.action.type,
    current: query ? currentRowFor(query, args.snapshot?.payload) : null,
    now: args.now,
    pageChange: compareFingerprints(implementation.pageBefore, implementation.pageAfter),
  });
}

/** A verdict that was saved once it became solid. Final: later snapshots (or their pruning) cannot change it. */
export type SavedOutcome = Outcome & { evaluatedAt: string };

export function savedOutcomeOf(result: Record<string, unknown> | null | undefined): SavedOutcome | null {
  const raw = result?.outcome as Partial<SavedOutcome> | undefined;
  if (!raw || typeof raw.status !== "string" || typeof raw.headline !== "string" || typeof raw.evaluatedAt !== "string") return null;
  return raw as SavedOutcome;
}

/** Whether this verdict is worth saving permanently: judged, and with enough time behind it. */
export function shouldSaveOutcome(outcome: Outcome): boolean {
  // An approximate baseline may already contain post-change numbers, so its verdict is not final.
  if (outcome.baseline?.approximate) return false;
  return outcome.confidence === "solid" && outcome.status !== "waiting" && outcome.status !== "no_data";
}
