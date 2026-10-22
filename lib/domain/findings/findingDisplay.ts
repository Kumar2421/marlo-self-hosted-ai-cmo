import type { Finding } from "./findingTypes.ts";
import { isAutoVerifiable } from "./verifyFinding.ts";

/**
 * Plain text for a title that arrives with inline-code markdown (Lighthouse writes
 * "`[user-scalable="no"]` is used in the `<meta name="viewport">` tag"). The backticks are
 * dropped for display; the stored text is not changed.
 */
export function stripInlineCode(text: string): string {
  return text.replace(/`/g, "");
}

/** A short, human title for a finding: the audit's own label when it has one, else the first sentence of the advice. */
export function findingTitle(finding: Pick<Finding, "evidence" | "recommendation">): string {
  const label = finding.evidence?.label;
  if (typeof label === "string" && label.trim()) return stripInlineCode(label.trim());
  const firstSentence = finding.recommendation.split(/(?<=[.!?])\s/)[0]?.trim();
  return firstSentence ? stripInlineCode(firstSentence) : "Untitled finding";
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { critical: 0, warning: 1, info: 2 };

/**
 * The on-page "heading order skips a level" check and Lighthouse's "heading-order" audit are the same
 * problem found two ways, and they can disagree on severity. They collapse to one finding per page.
 * Returns null for a finding that has no twin.
 */
function duplicateGroup(f: Pick<Finding, "source" | "entityId" | "url">): string | null {
  if (f.source !== "seo-audit") return null;
  if (f.entityId === "heading-order-skip" || /^lighthouse-(mobile|desktop)-heading-order$/.test(f.entityId)) {
    return `heading-order|${f.url ?? ""}`;
  }
  return null;
}

/**
 * One finding per real problem. For a duplicate group the most severe finding is kept, so the user
 * sees a single severity; on a tie the on-page check wins over the Lighthouse copy. Order is preserved.
 */
export function collapseDuplicateFindings<T extends Pick<Finding, "source" | "entityId" | "url" | "severity">>(findings: T[]): T[] {
  const best = new Map<string, T>();
  for (const f of findings) {
    const group = duplicateGroup(f);
    if (!group) continue;
    const current = best.get(group);
    if (!current) {
      best.set(group, f);
      continue;
    }
    const better =
      SEVERITY_RANK[f.severity] < SEVERITY_RANK[current.severity] ||
      (SEVERITY_RANK[f.severity] === SEVERITY_RANK[current.severity] && !f.entityId.startsWith("lighthouse-") && current.entityId.startsWith("lighthouse-"));
    if (better) best.set(group, f);
  }
  return findings.filter((f) => {
    const group = duplicateGroup(f);
    return !group || best.get(group) === f;
  });
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

export type FindingCountStat = { key: "needsAttention" | "critical" | "warning" | "verified"; label: string; value: number; tone?: "bad" | "good" };

/** The headline tiles on the Findings tab. The words here are the only ones the SEO overview uses too. */
export function findingCountStats(counts: FindingCounts): FindingCountStat[] {
  return [
    { key: "needsAttention", label: "Needs attention", value: counts.needsAttention },
    { key: "critical", label: "Critical", value: counts.critical, tone: "bad" },
    { key: "warning", label: "Warnings", value: counts.warning },
    { key: "verified", label: "Verified", value: counts.verified, tone: "good" },
  ];
}

/** The one-line summary for the SEO overview, from the same counts as the Findings tab: "6 findings need attention: 5 critical, 1 warning". */
export function findingCountSentence(counts: FindingCounts): string {
  if (counts.needsAttention === 0) return "No findings need attention";
  const head = `${counts.needsAttention} ${counts.needsAttention === 1 ? "finding needs" : "findings need"} attention`;
  const parts = [
    counts.critical > 0 && `${counts.critical} critical`,
    counts.warning > 0 && `${counts.warning} ${counts.warning === 1 ? "warning" : "warnings"}`,
  ].filter(Boolean);
  return parts.length > 0 ? `${head}: ${parts.join(", ")}` : head;
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
