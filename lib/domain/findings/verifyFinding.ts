import type { Finding } from "./findingTypes.ts";
import { reconcileSeoAuditRecheck } from "../seo/reconcileRecheck.ts";
import type { ReadinessCheck } from "../geo/readiness.ts";

/**
 * Automatic verification of one fixed finding. Pure: every outside effect
 * (re-running the SEO audit, re-running the GEO readiness checks) arrives
 * through ports, so the decision rules are tested with fakes. Never throws:
 * a check that cannot run is "skipped" and retried on a later run, never
 * "failed".
 */

export type VerifyOutcome = "verified" | "failed" | "skipped";

export type VerifyResult = {
  outcome: VerifyOutcome;
  /** A generic, user-safe sentence. Never raw error text. */
  reason: string;
  checkedAt: string;
};

/** One finding of a fresh SEO audit, in the shape reconcileSeoAuditRecheck expects. */
export type FreshAuditFinding = Parameters<typeof reconcileSeoAuditRecheck>[1][number];

/** A fresh audit: its findings, and the URL the crawl ended on when it is known. */
export type FreshAudit = { findings: FreshAuditFinding[]; finalUrl?: string };

export type VerifyCheckPorts = {
  /**
   * Re-runs the SEO audit of one page. May return the findings alone, or with the
   * final URL after redirects so a redirected page is not mistaken for the finding's page.
   */
  runSeoAudit(url: string): Promise<FreshAuditFinding[] | FreshAudit>;
  /** Re-runs the GEO readiness checks for the site that owns this URL. */
  runGeoReadiness(url: string): Promise<ReadinessCheck[]>;
};

export const PAGESPEED_SKIP_REASON = "Needs a PageSpeed run: use Re-check";

/**
 * Findings that only exist when a PageSpeed run produced them (Lighthouse
 * issues). A crawl-only audit never reports them, so their absence proves
 * nothing and they are never verified or failed automatically.
 */
export function needsPageSpeed(finding: { category: string; entityId: string }): boolean {
  return finding.category === "lighthouse" || finding.entityId.startsWith("lighthouse-");
}

/**
 * Whether verifyFinding can ever decide this finding. Every other finding is
 * skipped on every run, so the auto-verify job drops it before choosing what to
 * check. Mirrors the early returns of verifyFinding; keep the two in step.
 */
export function isAutoVerifiable(finding: Pick<Finding, "source" | "category" | "entityId" | "url">): boolean {
  if (finding.source === "search-console") return false;
  if (!finding.url) return false;
  if (needsPageSpeed(finding)) return false;
  if (finding.source === "seo-audit") return true;
  return finding.source === "geo" && finding.category === "geo_readiness";
}

function pagePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** True when the audit ended on a different origin or path than the finding's page (a redirect). */
export function redirectedAway(findingUrl: string, finalUrl: string | undefined): boolean {
  if (!finalUrl) return false;
  try {
    const a = new URL(findingUrl);
    const b = new URL(finalUrl);
    return a.origin.toLowerCase() !== b.origin.toLowerCase() || pagePath(a.pathname) !== pagePath(b.pathname);
  } catch {
    return false;
  }
}

const SEVERITY_FOR_RECHECK: Record<Finding["severity"], "info" | "warning" | "critical"> = {
  info: "info",
  warning: "warning",
  critical: "critical",
};

export async function verifyFinding(
  ports: VerifyCheckPorts,
  finding: Pick<Finding, "source" | "category" | "entityId" | "url" | "severity">,
  now: Date,
): Promise<VerifyResult> {
  const checkedAt = now.toISOString();
  const skipped = (reason: string): VerifyResult => ({ outcome: "skipped", reason, checkedAt });

  if (finding.source === "search-console") {
    return skipped("This finding is measured from search data, not re-checked on the page.");
  }
  if (!finding.url) return skipped("The finding has no page to check.");
  if (needsPageSpeed(finding)) return skipped(PAGESPEED_SKIP_REASON);

  try {
    if (finding.source === "seo-audit") {
      const audit = await ports.runSeoAudit(finding.url);
      const fresh = Array.isArray(audit) ? audit : audit.findings;
      if (!Array.isArray(audit) && redirectedAway(finding.url, audit.finalUrl)) {
        return skipped("The page now redirects elsewhere, so it cannot be checked. It will be retried.");
      }
      const result = reconcileSeoAuditRecheck(finding.entityId, fresh, SEVERITY_FOR_RECHECK[finding.severity] ?? "warning");
      return result.issueDetected
        ? { outcome: "failed", reason: "The audit still flags this issue.", checkedAt }
        : { outcome: "verified", reason: "The audit no longer flags this issue.", checkedAt };
    }

    if (finding.source === "geo" && finding.category === "geo_readiness") {
      const checks = await ports.runGeoReadiness(finding.url);
      const check = checks.find((c) => c.id === finding.entityId);
      if (!check) return skipped("This readiness check is not available for the site right now.");
      if (check.status === "unknown") return skipped("The site could not be read for this check. It will be retried.");
      if (check.status === "pass") return { outcome: "verified", reason: `The readiness check now passes: ${check.label}.`, checkedAt };
      return { outcome: "failed", reason: `The readiness check still fails: ${check.label}.`, checkedAt };
    }

    return skipped("There is no automatic check for this kind of finding.");
  } catch {
    return skipped("The check could not run. It will be retried.");
  }
}
