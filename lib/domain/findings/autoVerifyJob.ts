import type { Finding } from "./findingTypes.ts";
import { implementationOf } from "../search/actionOutcome.ts";
import { runWithBudget } from "../../jobs/jobRunner.ts";
import { isVanished, vanishedMark } from "./vanishedFindings.ts";
import { isAutoVerifiable, verifyFinding, type VerifyCheckPorts, type VerifyResult } from "./verifyFinding.ts";
import { BACKGROUND_AUDIT_TIMEOUT_MS, MIN_AUDIT_BUDGET_MS, timedCall } from "./timedAudit.ts";

/**
 * The daily auto-verification pass. A fix is checked once its change has been
 * live for a day: the finding moves fixed -> verified or fixed -> failed with
 * no user click. Stateless apart from one small marker per finding, so reruns
 * and overlapping invocations are harmless. Storage is behind ports.
 */

export const AUTO_VERIFY_DELAY_MS = 24 * 60 * 60 * 1000;
/** Decided checks (verified or failed) a finding gets. A skipped check does not count. */
export const AUTO_VERIFY_MAX_ATTEMPTS = 3;
/** Skipped checks (could not run, timed out, redirected) before a finding is left to a manual re-check. */
export const AUTO_VERIFY_MAX_SKIPS = 10;
/** A finding checked this recently is not checked again (keeps reruns idempotent). */
export const AUTO_VERIFY_RECHECK_GAP_MS = 12 * 60 * 60 * 1000;
export const AUTO_VERIFY_MARKER_PREFIX = "auto_verify:";
export const STILL_DETECTED_NOTE = "Still detected after the change";

export type AutoVerifyMarker = {
  /** Decided checks so far. */
  attempts: number;
  lastCheckedAt: string;
  /** Skipped checks so far (absent in older markers). */
  skips?: number;
  /** The evidence.vanished.at flag this finding was last checked for: a vanished finding is checked once per flag. */
  vanishedAt?: string;
};

export type ProjectScope = { userId: string; projectId: string };

/**
 * A finding the job may check. Besides fixed findings this carries two extra kinds, both
 * still under the same caps/backoff: geo_gap findings (status fixed or fixing) and
 * seo-audit findings flagged evidence.vanished (any vanishable status).
 */
export type FixedFinding = ProjectScope & {
  finding: Finding;
  /** The saved `result` of each completed action linked to this finding. */
  actionResults: Array<Record<string, unknown> | null>;
};

export type JobBudget = {
  budgetMs: number;
  /** Global cap on checks in one run. */
  maxItems: number;
  /** Injectable clock for the time budget; defaults to Date.now. */
  clock?: () => number;
  /** Per-audit timeout ceiling (defaults to BACKGROUND_AUDIT_TIMEOUT_MS). */
  auditTimeoutMs?: number;
  /** Minimum budget left before an audit may start (defaults to MIN_AUDIT_BUDGET_MS). */
  minAuditMs?: number;
};

export type AutoVerifyPorts = {
  listFixedFindings(): Promise<FixedFinding[]>;
  readMarkers(scope: ProjectScope): Promise<Map<string, AutoVerifyMarker>>;
  writeMarker(scope: ProjectScope, findingId: string, marker: AutoVerifyMarker): Promise<void>;
  checkPorts(item: FixedFinding): VerifyCheckPorts;
  /** Atomically persist the terminal status and its verification evidence when supported. */
  finalize?(item: FixedFinding, status: "verified" | "failed", evidence: Record<string, unknown>): Promise<void>;
  transition(item: FixedFinding, status: "verified" | "failed"): Promise<void>;
  saveEvidence(item: FixedFinding, evidence: Record<string, unknown>): Promise<void>;
};

export type AutoVerifySummary = {
  verified: number;
  failed: number;
  skipped: number;
  /** Vanished-flagged findings the page re-audit still reports: evidence updated, status unchanged. */
  stillDetected: number;
  /** Eligible findings left for the next run (over the cap or out of time). */
  budgetSkipped: number;
  /** Findings whose storage step threw; isolated, the rest of the run continues. */
  errored: number;
};

/** The latest implementation time across a finding's completed actions, as epoch ms, or null. */
export function latestImplementedAt(actionResults: Array<Record<string, unknown> | null>): number | null {
  let latest: number | null = null;
  for (const result of actionResults) {
    const implementation = implementationOf(result);
    if (!implementation) continue;
    const at = Date.parse(implementation.implementedAt);
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

/** Evidence written to the finding: the auto result, plus the still-detected note on failure. */
export function autoVerifyEvidence(
  evidence: Record<string, unknown>,
  result: Pick<VerifyResult, "outcome" | "reason" | "checkedAt">,
): Record<string, unknown> {
  const autoVerify: Record<string, unknown> = { outcome: result.outcome, reason: result.reason, checkedAt: result.checkedAt };
  if (result.outcome === "failed") autoVerify.note = STILL_DETECTED_NOTE;
  return { ...evidence, autoVerify };
}

type Eligible = { item: FixedFinding; attempts: number; skips: number; lastCheckedAt: string | null; vanishedAt?: string; keepVanishedAt?: string };

export type AutoVerifyKind = "fixed" | "geo_gap" | "vanished";

export function autoVerifyKind(finding: Finding): AutoVerifyKind {
  if (finding.source === "geo" && finding.category === "geo_gap") return "geo_gap";
  if (finding.source === "seo-audit" && isVanished(finding)) return "vanished";
  return "fixed";
}

/**
 * Stored-rows-only gate for a geo gap, before any attempt is spent: a fixed gap needs a newer run
 * (either verdict decides it); a gap still being fixed is only closed by a run that names the project.
 */
async function gapIsDecidable(ports: AutoVerifyPorts, item: FixedFinding): Promise<boolean> {
  if (item.finding.status !== "fixed" && item.finding.status !== "fixing") return false;
  const verdictOf = ports.checkPorts(item).geoGapVerdict;
  if (!verdictOf) return false;
  try {
    const verdict = await verdictOf(item.finding);
    return item.finding.status === "fixed" ? verdict !== "no-new-runs" : verdict === "mentioned";
  } catch {
    return false;
  }
}

export async function runAutoVerify(ports: AutoVerifyPorts, now: Date, budget: JobBudget): Promise<AutoVerifySummary> {
  const summary: AutoVerifySummary = { verified: 0, failed: 0, skipped: 0, stillDetected: 0, budgetSkipped: 0, errored: 0 };
  const nowMs = now.getTime();

  // Only findings the verifier can check, whose change went live at least a day
  // ago. Findings it always skips (PageSpeed-only, search data, no page) are
  // dropped here, before the cap, so they never take a slot or burn an attempt.
  // A project whose markers cannot be read is isolated: its findings are counted as errored.
  const due = (await ports.listFixedFindings()).filter((item) => {
    if (!isAutoVerifiable(item.finding)) return false;
    // A geo gap is gated by a newer stored run and a vanished page by its flag, not by an implementation delay.
    if (autoVerifyKind(item.finding) !== "fixed") return true;
    const implementedAt = latestImplementedAt(item.actionResults);
    return implementedAt !== null && nowMs - implementedAt >= AUTO_VERIFY_DELAY_MS;
  });

  const markersByProject = new Map<string, Map<string, AutoVerifyMarker> | null>();
  const eligible: Eligible[] = [];
  for (const item of due) {
    const key = item.projectId;
    if (!markersByProject.has(key)) {
      try {
        markersByProject.set(key, await ports.readMarkers(item));
      } catch {
        markersByProject.set(key, null);
      }
    }
    const markers = markersByProject.get(key);
    if (!markers) {
      summary.errored += 1;
      continue;
    }
    const marker = markers.get(item.finding.id);
    const attempts = marker?.attempts ?? 0;
    const skips = marker?.skips ?? 0;
    if (attempts >= AUTO_VERIFY_MAX_ATTEMPTS || skips >= AUTO_VERIFY_MAX_SKIPS) continue;
    const lastCheckedAt = marker?.lastCheckedAt ?? null;
    if (lastCheckedAt !== null && nowMs - Date.parse(lastCheckedAt) < AUTO_VERIFY_RECHECK_GAP_MS) continue;
    const kind = autoVerifyKind(item.finding);
    let vanishedAt: string | undefined;
    if (kind === "vanished") {
      // At most one automatic re-audit per vanished flag, so a still-flagged page never loops.
      vanishedAt = vanishedMark(item.finding.evidence)?.at;
      if (!vanishedAt || marker?.vanishedAt === vanishedAt) continue;
    }
    if (kind === "geo_gap" && !(await gapIsDecidable(ports, item))) continue;
    eligible.push({ item, attempts, skips, lastCheckedAt, vanishedAt, keepVanishedAt: marker?.vanishedAt });
  }

  // Fair rotation: never-checked first, then the oldest check.
  eligible.sort((a, b) => {
    const aAt = a.lastCheckedAt ?? "";
    const bAt = b.lastCheckedAt ?? "";
    return aAt.localeCompare(bAt) || a.item.finding.id.localeCompare(b.item.finding.id);
  });

  const picked = eligible.slice(0, Math.max(0, budget.maxItems));
  summary.budgetSkipped += eligible.length - picked.length;

  const clock = budget.clock ?? Date.now;
  const deadline = clock() + budget.budgetMs;
  const minAuditMs = budget.minAuditMs ?? MIN_AUDIT_BUDGET_MS;
  const auditTimeoutMs = budget.auditTimeoutMs ?? BACKGROUND_AUDIT_TIMEOUT_MS;

  const run = await runWithBudget(
    picked,
    async ({ item, attempts, skips, vanishedAt, keepVanishedAt }) => {
      const stamp = vanishedAt ?? keepVanishedAt;
      const withFlag = (m: AutoVerifyMarker): AutoVerifyMarker => (stamp ? { ...m, vanishedAt: stamp } : m);
      // Stop the phase before an audit that cannot finish inside the budget.
      const left = deadline - clock();
      if (left < minAuditMs) {
        summary.budgetSkipped += 1;
        return;
      }
      // Hard timeout per audit: a timeout is a skip: retried later, and it does not use a decided attempt.
      const timed = await timedCall(() => verifyFinding(ports.checkPorts(item), item.finding, now), Math.min(auditTimeoutMs, left));
      const result: VerifyResult = timed.ok
        ? timed.value
        : { outcome: "skipped", reason: "The check ran out of time. It will be retried.", checkedAt: now.toISOString() };
      const decided = result.outcome === "verified" ? "verified" : result.outcome === "failed" ? "failed" : null;
      // Only decided outcomes use an attempt; a skip stamps the check time and counts against the skip cap.
      if (decided === null) {
        summary.skipped += 1;
        await ports.writeMarker(item, item.finding.id, withFlag({ attempts, skips: skips + 1, lastCheckedAt: now.toISOString() }));
      } else if (decided === "failed" && vanishedAt) {
        // The re-audit still reports an issue the earlier audit missed: no status change (the user never
        // said it was fixed), the flag is dropped and the result kept as evidence.
        const rest = { ...item.finding.evidence };
        delete rest.vanished;
        await ports.saveEvidence(item, autoVerifyEvidence(rest, result));
        summary.stillDetected += 1;
        await ports.writeMarker(item, item.finding.id, withFlag({ attempts: attempts + 1, skips, lastCheckedAt: now.toISOString() }));
      } else {
        const evidence = autoVerifyEvidence(item.finding.evidence, result);
        if (ports.finalize) {
          await ports.finalize(item, decided, evidence);
        } else {
          // Compatibility for non-platform adapters; production uses atomic finalize.
          await ports.transition(item, decided);
          await ports.saveEvidence(item, evidence);
        }
        summary[decided] += 1;
        await ports.writeMarker(item, item.finding.id, withFlag({ attempts: attempts + 1, skips, lastCheckedAt: now.toISOString() }));
      }
    },
    { budgetMs: budget.budgetMs, now: clock },
  );

  summary.budgetSkipped += run.skipped;
  summary.errored += run.failed.length;
  return summary;
}

/** Marker key for one finding, as stored in project_documents. */
export function autoVerifyDocType(findingId: string): string {
  return AUTO_VERIFY_MARKER_PREFIX + findingId;
}
