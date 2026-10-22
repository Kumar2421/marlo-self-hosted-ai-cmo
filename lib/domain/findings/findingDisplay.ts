import type { Finding } from "./findingTypes.ts";
import { isAutoVerifiable } from "./verifyFinding.ts";

/** A short, human title for a finding: the audit's own label when it has one, else the first sentence of the advice. */
export function findingTitle(finding: Pick<Finding, "evidence" | "recommendation">): string {
  const label = finding.evidence?.label;
  if (typeof label === "string" && label.trim()) return label.trim();
  const firstSentence = finding.recommendation.split(/(?<=[.!?])\s/)[0]?.trim();
  return firstSentence || "Untitled finding";
}

/** "https://example.com/blog/post?x=1" → "/blog/post"; the home page shows as "/". Falls back to the raw text. */
export function pagePath(url: string | null | undefined): string {
  if (!url) return "No page";
  try {
    const { pathname } = new URL(url);
    return pathname === "" ? "/" : pathname;
  } catch {
    return url;
  }
}

export type FindingCounts = {
  /** Still a problem: not yet fixed, or fixed but the re-check failed. */
  needsAttention: number;
  /** Fixed by the user and waiting for Marlo's re-check. Not counted as a problem, not yet proven fixed. */
  awaitingVerification: number;
  critical: number;
  warning: number;
  verified: number;
};

/**
 * Headline numbers for the findings summary. A verified finding no longer needs attention, and a
 * fixed one is only awaiting its re-check, so neither counts as unresolved. Severities count unresolved only.
 */
export function countFindings(findings: Array<Pick<Finding, "severity" | "status">>): FindingCounts {
  const unresolved = findings.filter((f) => f.status !== "verified" && f.status !== "fixed");
  return {
    needsAttention: unresolved.length,
    awaitingVerification: findings.filter((f) => f.status === "fixed").length,
    critical: unresolved.filter((f) => f.severity === "critical").length,
    warning: unresolved.filter((f) => f.severity === "warning").length,
    verified: findings.filter((f) => f.status === "verified").length,
  };
}

const SEVERITY_WORD: Record<Finding["severity"], string> = { critical: "Critical", warning: "Warning", info: "Info" };
const STATUS_PHRASE: Record<Finding["status"], string> = {
  new: "new",
  acknowledged: "acknowledged",
  fixing: "being fixed",
  fixed: "awaiting re-check",
  verified: "verified fixed",
  failed: "still detected after a fix",
};

/**
 * Why a finding sits where it does in the list, in plain words ("Critical, new, on your homepage").
 * Mirrors the list order: unresolved before verified, then by severity.
 */
export function explainPriority(finding: Pick<Finding, "severity" | "status" | "url">): string {
  const parts = [SEVERITY_WORD[finding.severity], STATUS_PHRASE[finding.status]];
  if (finding.url) {
    const path = pagePath(finding.url);
    parts.push(path === "/" ? "on your homepage" : `on ${path}`);
  }
  return parts.join(", ");
}

/** What to tell the user once a fix pull request is merged, based on how Marlo can actually follow up. */
export function mergedPullRequestNote(finding: Pick<Finding, "source" | "category" | "entityId" | "url" | "evidence">): string {
  if (isAutoVerifiable(finding)) {
    return "Merged. Marlo re-checks this page about 24 hours after the merge and will mark it verified or still detected.";
  }
  // Only search opportunities have a before/after measurement of clicks and impressions (actionOutcome).
  if (finding.source === "search-console" && finding.evidence && typeof finding.evidence.opportunity === "object" && finding.evidence.opportunity !== null) {
    return "Merged. Marlo is measuring what the change did.";
  }
  return "Merged. Marlo does not re-check this kind of finding on its own: use Re-check once your site has deployed the change.";
}
