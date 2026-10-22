import type { Finding } from "./findingTypes.ts";
import type { FindingRecheckResult } from "./findingService.ts";
import { verifyFinding, type FreshAudit, type FreshAuditFinding, type VerifyCheckPorts } from "./verifyFinding.ts";
import { reconcileSeoAuditRecheck } from "../seo/reconcileRecheck.ts";
import type { ReadinessCheck } from "../geo/readiness.ts";

/**
 * The decision behind a manual Re-check. It goes through verifyFinding (the same
 * rules as the auto-verify job: GEO readiness checks, redirect guard, PageSpeed
 * findings skipped without PageSpeed data), so a check that could not run or
 * cannot prove anything is "skipped" and changes nothing, never a false "verified".
 * Pure: the audit and the readiness checks arrive through ports.
 */

export type RecheckDecision =
  | { kind: "skipped"; reason: string }
  | { kind: "checked"; outcome: "verified" | "failed"; result: FindingRecheckResult };

type RecheckFinding = Pick<Finding, "source" | "category" | "entityId" | "url" | "severity"> & Partial<Pick<Finding, "evidence" | "firstSeen" | "status" | "recommendation">>;

/** A decision from a check that has already produced a FindingRecheckResult (search snapshots, the search-console page audit). */
export function checkedDecision(result: FindingRecheckResult): RecheckDecision {
  return { kind: "checked", outcome: result.issueDetected ? "failed" : "verified", result };
}

export async function decideRecheck(
  ports: VerifyCheckPorts,
  finding: RecheckFinding,
  now: Date,
  options: { allowPageSpeed?: boolean } = {},
): Promise<RecheckDecision> {
  let seoFindings: FreshAuditFinding[] | null = null;
  let readiness: ReadinessCheck[] | null = null;
  const capturing: VerifyCheckPorts = {
    runSeoAudit: async (url) => {
      const audit = await ports.runSeoAudit(url);
      seoFindings = Array.isArray(audit) ? audit : (audit as FreshAudit).findings;
      return audit;
    },
    runGeoReadiness: async (url) => {
      readiness = await ports.runGeoReadiness(url);
      return readiness;
    },
    geoGapVerdict: ports.geoGapVerdict,
  };

  const verdict = await verifyFinding(capturing, finding, now, options);
  if (verdict.outcome === "skipped") return { kind: "skipped", reason: verdict.reason };
  const issueDetected = verdict.outcome === "failed";

  if (finding.source === "geo" && finding.category === "geo_gap") {
    // S8 rules: later answers naming the project verify the gap at any open status; later answers
    // that still miss fail it only when the user said it was fixed, otherwise the fix is still pending.
    if (issueDetected && finding.status !== "fixed") {
      return { kind: "skipped", reason: "Fix pending: later AI answers still do not name you. Mark the fix as done, then re-check." };
    }
    const evidence = { ...(finding.evidence ?? {}), verification: { outcome: verdict.outcome, reason: verdict.reason, checkedAt: verdict.checkedAt } };
    return {
      kind: "checked",
      outcome: verdict.outcome,
      result: { issueDetected, severity: finding.severity, recommendation: finding.recommendation ?? "", evidence },
    };
  }

  if (finding.source === "seo-audit" && seoFindings) {
    const reconciled = reconcileSeoAuditRecheck(finding.entityId, seoFindings, finding.severity);
    return { kind: "checked", outcome: verdict.outcome, result: { ...reconciled, issueDetected } };
  }

  const check = (readiness as ReadinessCheck[] | null)?.find((c) => c.id === finding.entityId);
  if (finding.source === "geo" && check) {
    return {
      kind: "checked",
      outcome: verdict.outcome,
      result: {
        issueDetected,
        severity: finding.severity,
        recommendation: issueDetected ? check.fix : "The readiness check now passes. Keep it under observation.",
        evidence: { check: { id: check.id, label: check.label, status: check.status, detail: check.detail } },
      },
    };
  }

  // verifyFinding only decides the two kinds above; anything else cannot reach here.
  return { kind: "skipped", reason: "There is no automatic check for this kind of finding." };
}
