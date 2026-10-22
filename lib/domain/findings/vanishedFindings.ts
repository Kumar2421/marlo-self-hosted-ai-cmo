import type { Finding } from "./findingTypes.ts";
import { redirectedAway } from "./verifyFinding.ts";

/**
 * Findings whose issue a newer audit of the same page no longer reports.
 *
 * Absence is a hint, never proof: the finding is only flagged ("No longer
 * detected in the last audit"), it stays open and still counts as needing
 * attention until a real Re-check verifies it. Nothing here changes a status.
 * The flag lives in `evidence.vanished` and is dropped the moment the issue is
 * reported again (the audit upsert rewrites the evidence) or a re-check runs
 * (it replaces the evidence).
 */

/** The parts of a finished audit this reads (structurally the SEOAgent payload). */
export type VanishAudit = {
  url: string;
  finalUrl?: string;
  findings: ReadonlyArray<{ issueId: string }>;
  /** Which finding families the run could decide. Missing means only the on-page checks. */
  checksRan?: { lighthouse?: boolean };
  /** The audit did not complete (crawl failed). Nothing may vanish. */
  failed?: boolean;
};

export type VanishCandidate = Pick<Finding, "id" | "source" | "category" | "entityId" | "url" | "status" | "evidence">;

/** Statuses where the user still has the problem on their list. A fixed finding is already waiting for a re-check. */
export const VANISHABLE_STATUSES: readonly Finding["status"][] = ["new", "acknowledged", "fixing", "failed"];

export type VanishedMark = { at: string; auditAt: string };

function samePage(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

function isLighthouse(f: { category: string; entityId: string }): boolean {
  return f.category === "lighthouse" || f.entityId.startsWith("lighthouse-");
}

export function vanishedMark(evidence: Record<string, unknown>): VanishedMark | null {
  const v = evidence?.vanished as { at?: unknown; auditAt?: unknown } | undefined;
  return v && typeof v.at === "string" ? { at: v.at, auditAt: typeof v.auditAt === "string" ? v.auditAt : v.at } : null;
}

/**
 * Open findings of the audited page that this audit would have reported if the
 * issue were still there, and did not. Pure.
 */
export function findVanishedFindings<T extends VanishCandidate>(openFindings: readonly T[], audit: VanishAudit): T[] {
  if (audit.failed || !audit.url) return [];
  // A redirect means the crawl read another page: it proves nothing about this one.
  if (redirectedAway(audit.url, audit.finalUrl)) return [];
  const reported = new Set(audit.findings.map((f) => f.issueId));
  const lighthouseRan = audit.checksRan?.lighthouse === true;
  return openFindings.filter((f) => {
    if (f.source !== "seo-audit" || !f.url || !samePage(f.url, audit.url)) return false;
    if (!VANISHABLE_STATUSES.includes(f.status)) return false;
    if (isLighthouse(f) && !lighthouseRan) return false;
    return !reported.has(f.entityId);
  });
}

export type VanishPorts = {
  list(projectId: string): Promise<Finding[]> | Finding[];
  /** Writes evidence only: no status change, no last_seen change. Conditional on the status that was read. */
  setEvidence(finding: Finding, evidence: Record<string, unknown>): Promise<unknown> | unknown;
};

/**
 * Call after the audit's findings were saved. Flags every newly vanished
 * finding of the audited page (once: the first audit that missed it keeps its
 * date). Never throws: a failed flag is cosmetic, the audit result stands.
 */
export async function flagVanishedFindings(
  ports: VanishPorts,
  projectId: string,
  audit: VanishAudit,
  auditAt: string,
): Promise<number> {
  try {
    const open = await ports.list(projectId);
    const vanished = findVanishedFindings(open, audit).filter((f) => !vanishedMark(f.evidence));
    let flagged = 0;
    for (const f of vanished) {
      try {
        await ports.setEvidence(f, { ...f.evidence, vanished: { at: auditAt, auditAt } satisfies VanishedMark });
        flagged += 1;
      } catch {
        // A concurrent status change wins; the next audit flags it again.
      }
    }
    return flagged;
  } catch {
    return 0;
  }
}

/** A flagged finding the user can act on with Re-check; null when it is not flagged or no longer open. */
export const VANISHED_LINE = "No longer detected in the last audit. Re-check to verify.";

export function vanishedNote(finding: Pick<Finding, "status" | "evidence">): string | null {
  return VANISHABLE_STATUSES.includes(finding.status) && vanishedMark(finding.evidence) ? VANISHED_LINE : null;
}

export function isVanished(finding: Pick<Finding, "status" | "evidence">): boolean {
  return vanishedNote(finding) !== null;
}
