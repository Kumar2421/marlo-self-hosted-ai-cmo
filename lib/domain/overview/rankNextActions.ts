/**
 * Pure ranking for the Today / "Needs your attention" overview: turns what Marlo knows about a
 * project into at most a handful of plain-language next actions. Deterministic (same input, same
 * output), never mutates its input, and touches no network, DB or clock (`now` is an input).
 */
import { classifyFinding } from "../codefix/fixCatalog.ts";
import { findingTitle } from "../findings/findingDisplay.ts";
import type { Finding } from "../findings/findingTypes.ts";
import { COPY } from "./copy.ts";

export type NextActionKind =
  | "fix_finding"
  | "review_pr"
  | "connect_integration"
  | "run_audit"
  | "send_outreach"
  | "verify_fix"
  | "celebrate";

export type NextActionTarget = {
  type: "finding" | "pr" | "settings" | "panel" | "audit";
  id?: string;
};

export type NextAction = {
  id: string;
  kind: NextActionKind;
  title: string;
  why: string;
  impact: "high" | "medium" | "low";
  effort: "minutes" | "hour";
  cta: { label: string; target: NextActionTarget };
  score: number;
  reasons: string[];
};

export type RankFinding = Pick<
  Finding,
  "id" | "status" | "severity" | "source" | "firstSeen" | "lastSeen" | "recommendation" | "evidence"
> &
  Partial<Pick<Finding, "category" | "entityId" | "url">>;

export type RankPullRequest = { id: string; findingId?: string | null; title?: string; openedAt?: string };
export type RankPendingAction = { id: string; findingId?: string | null };

export type IntegrationKey = "gsc" | "ga4" | "github" | "gmail" | "cms";

export type RankInput = {
  findings: readonly RankFinding[];
  openFixPullRequests: readonly RankPullRequest[];
  pendingActions: readonly RankPendingAction[];
  integrations: Record<IntegrationKey, boolean>;
  leads: { count: number; withEmail: number; unsent: number };
  lastAuditAt: string | null;
  now: string | Date;
};

export type RankOptions = { max?: number; staleAuditDays?: number };

const DAY_MS = 86_400_000;
export const DEFAULT_MAX_ACTIONS = 3;
export const DEFAULT_STALE_AUDIT_DAYS = 7;

const SEVERITY_POINTS = { critical: 60, warning: 40, info: 20 } as const;
const STATUS_POINTS: Partial<Record<Finding["status"], number>> = { new: 15, failed: 12, acknowledged: 8, fixing: 5 };
const IMPACT_BY_SEVERITY = { critical: "high", warning: "medium", info: "low" } as const;
const FIXABLE_BONUS = 10;
const PR_BASE = 150;
const KIND_ORDER: Record<NextActionKind, number> = {
  review_pr: 0,
  run_audit: 1,
  fix_finding: 2,
  verify_fix: 3,
  connect_integration: 4,
  send_outreach: 5,
  celebrate: 6,
};
const CONNECT_ORDER: IntegrationKey[] = ["gsc", "github", "ga4", "gmail", "cms"];

function toMs(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days between `then` and `now`, never negative; null when either date is unusable. */
function ageDays(then: string | Date | null | undefined, nowMs: number): number | null {
  const ms = toMs(then);
  return ms === null ? null : Math.max(0, Math.floor((nowMs - ms) / DAY_MS));
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function findingFixable(f: RankFinding): boolean {
  return classifyFinding({ source: f.source, category: f.category, entityId: f.entityId ?? "", evidence: f.evidence }).mode === "auto";
}

function rankFinding(f: RankFinding, nowMs: number, hasPendingAction: boolean): NextAction | null {
  const label = findingTitle({ evidence: f.evidence ?? {}, recommendation: f.recommendation ?? "" });
  const target: NextActionTarget = { type: "finding", id: f.id };

  if (f.status === "fixed") {
    const waiting = ageDays(f.lastSeen, nowMs) ?? 0;
    return {
      id: `finding:${f.id}`,
      kind: "verify_fix",
      title: COPY.verifyFix.title(label),
      why: COPY.verifyFix.why,
      impact: "medium",
      effort: "minutes",
      cta: { label: COPY.verifyFix.cta, target },
      score: 70 + Math.min(waiting, 7),
      reasons: ["marked fixed but not yet confirmed", ...(waiting > 0 ? [`waiting ${waiting}d`] : [])],
    };
  }

  const statusPoints = STATUS_POINTS[f.status];
  if (statusPoints === undefined) return null; // verified: nothing left to do

  let score = SEVERITY_POINTS[f.severity] + statusPoints;
  const reasons = [`${f.severity} severity`, `status ${f.status}`];

  const seenAge = ageDays(f.firstSeen, nowMs);
  if (seenAge !== null && seenAge <= 3) {
    score += 8;
    reasons.push("found in the last 3 days");
  } else if (seenAge !== null && seenAge <= 14) {
    score += 4;
    reasons.push("found in the last 2 weeks");
  }

  const fixable = findingFixable(f);
  if (fixable) {
    score += FIXABLE_BONUS;
    reasons.push("can be fixed with a PR");
  }
  if (hasPendingAction) reasons.push("a suggested change is already waiting");

  return {
    id: `finding:${f.id}`,
    kind: "fix_finding",
    title: fixable ? COPY.fixFinding.fixableTitle(label) : COPY.fixFinding.manualTitle(label),
    why: f.status === "failed" ? COPY.fixFinding.whyFailed : COPY.fixFinding.whyBySeverity[f.severity],
    impact: IMPACT_BY_SEVERITY[f.severity],
    effort: fixable ? "minutes" : "hour",
    cta: { label: fixable ? COPY.fixFinding.ctaFixable : COPY.fixFinding.ctaManual, target },
    score,
    reasons,
  };
}

function rankPullRequest(pr: RankPullRequest, nowMs: number): NextAction {
  const waiting = ageDays(pr.openedAt, nowMs) ?? 0;
  return {
    id: `pr:${pr.id}`,
    kind: "review_pr",
    title: COPY.reviewPr.title(pr.title),
    why: COPY.reviewPr.why,
    impact: "high",
    effort: "minutes",
    cta: { label: COPY.reviewPr.cta, target: { type: "pr", id: pr.id } },
    score: PR_BASE + Math.min(waiting, 10),
    reasons: ["fix is waiting for your review", ...(waiting > 0 ? [`open for ${waiting}d`] : [])],
  };
}

/** At most one integration prompt, so the list never turns into a setup wizard. */
function connectAction(input: RankInput, hasFixable: boolean): NextAction | null {
  const missing = (k: IntegrationKey) => !input.integrations?.[k];
  const candidates: Array<{ key: IntegrationKey; score: number; reason: string }> = [];
  if (missing("gsc")) candidates.push({ key: "gsc", score: 85, reason: "no search data yet" });
  if (missing("github")) {
    candidates.push({
      key: "github",
      score: hasFixable ? 60 : 30,
      reason: hasFixable ? "fixes are ready to prepare but no code is connected" : "needed to prepare fixes",
    });
  }
  if (missing("ga4")) candidates.push({ key: "ga4", score: 40, reason: "no visitor data" });
  if (missing("gmail") && input.leads.count > 0) candidates.push({ key: "gmail", score: 45, reason: "leads found but email is not connected" });
  if (missing("cms")) candidates.push({ key: "cms", score: 20, reason: "publishing is not connected" });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score || CONNECT_ORDER.indexOf(a.key) - CONNECT_ORDER.indexOf(b.key));
  const best = candidates[0];
  const copy = COPY.connect[best.key];
  return {
    id: `connect:${best.key}`,
    kind: "connect_integration",
    title: copy.title,
    why: copy.why,
    impact: best.key === "gsc" || best.key === "github" ? "high" : "medium",
    effort: "minutes",
    cta: { label: copy.cta, target: { type: "settings", id: best.key } },
    score: best.score,
    reasons: [best.reason],
  };
}

function compareActions(a: NextAction, b: NextAction): number {
  if (a.score !== b.score) return b.score - a.score;
  if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function rankNextActions(input: RankInput, opts: RankOptions = {}): NextAction[] {
  const max = Math.max(0, Math.floor(opts.max ?? DEFAULT_MAX_ACTIONS));
  const staleDays = opts.staleAuditDays ?? DEFAULT_STALE_AUDIT_DAYS;
  const nowMs = toMs(input.now) ?? 0;
  const findings = input.findings ?? [];
  const prs = input.openFixPullRequests ?? [];
  const pending = input.pendingActions ?? [];
  if (max === 0) return [];

  const actions: NextAction[] = [];
  const seen = new Set<string>();
  const push = (a: NextAction | null) => {
    if (a && !seen.has(a.id)) {
      seen.add(a.id);
      actions.push(a);
    }
  };

  // A finding that already has an open PR is covered by that PR (one action per finding).
  const coveredByPr = new Set<string>();
  for (const pr of prs) {
    push(rankPullRequest(pr, nowMs));
    if (pr.findingId) coveredByPr.add(pr.findingId);
  }

  const pendingFor = new Set(pending.map((p) => p.findingId).filter((id): id is string => !!id));
  let hasFixable = false;
  for (const f of findings) {
    if (coveredByPr.has(f.id)) continue;
    const action = rankFinding(f, nowMs, pendingFor.has(f.id));
    if (action?.kind === "fix_finding" && action.effort === "minutes") hasFixable = true;
    push(action);
  }

  const lastAuditMs = toMs(input.lastAuditAt);
  const auditAge = ageDays(input.lastAuditAt, nowMs);
  if (auditAge === null) {
    push({
      id: "audit:run",
      kind: "run_audit",
      title: COPY.runAudit.neverTitle,
      why: COPY.runAudit.neverWhy,
      impact: "high",
      effort: "minutes",
      cta: { label: COPY.runAudit.cta, target: { type: "audit" } },
      score: 95,
      reasons: ["no site check has run yet"],
    });
  } else if (auditAge > staleDays) {
    push({
      id: "audit:run",
      kind: "run_audit",
      title: COPY.runAudit.staleTitle,
      why: COPY.runAudit.staleWhy(auditAge),
      impact: "medium",
      effort: "minutes",
      cta: { label: COPY.runAudit.cta, target: { type: "audit" } },
      score: 88,
      reasons: [`last check was ${auditAge}d ago`],
    });
  }

  push(connectAction(input, hasFixable));

  if (input.integrations?.gmail && input.leads.unsent > 0 && input.leads.withEmail > 0) {
    const n = Math.min(input.leads.unsent, input.leads.withEmail);
    push({
      id: "outreach:send",
      kind: "send_outreach",
      title: COPY.sendOutreach.title(n),
      why: COPY.sendOutreach.why,
      impact: "medium",
      effort: n > 10 ? "hour" : "minutes",
      cta: { label: COPY.sendOutreach.cta, target: { type: "panel", id: "leads" } },
      score: 55 + Math.min(n, 20) / 2,
      reasons: [`${n} unsent with an email address`],
    });
  }

  if (actions.length === 0) {
    const nextCheck = isoDate(Math.max((lastAuditMs ?? nowMs) + staleDays * DAY_MS, nowMs + DAY_MS));
    return [
      {
        id: "celebrate",
        kind: "celebrate",
        title: COPY.celebrate.title,
        why: COPY.celebrate.why(nextCheck),
        impact: "low",
        effort: "minutes",
        cta: { label: COPY.celebrate.cta, target: { type: "panel", id: "overview" } },
        score: 0,
        reasons: ["nothing needs attention", `next check ${nextCheck}`],
      },
    ];
  }

  return actions.sort(compareActions).slice(0, max);
}
