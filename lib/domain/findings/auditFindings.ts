import { explainFinding } from "../seo/findingExplanations.ts";

/**
 * The one definition of how an SEO audit becomes findings. The audit route
 * and the weekly monitor both call this, so a re-audit always lands on the
 * same finding identity (source, category, entity type, entity id, url) and
 * never creates a duplicate.
 */

/** The parts of an SEO audit this mapping reads (structurally the SEOAgent payload). */
export type AuditLike = {
  url: string;
  findings: Array<{
    issueId: string;
    category: string;
    severity: "Warning" | "Error";
    label: string;
    evidence: Record<string, string | number | null>;
  }>;
};

export type AuditFindingInput = {
  projectId: string;
  source: "seo-audit";
  category: string;
  severity: "critical" | "warning";
  entityType: "page-issue";
  entityId: string;
  url: string;
  evidence: Record<string, unknown>;
  recommendation: string;
};

/**
 * Findings for one audit. `extraEvidence` lets a caller add keys to one
 * issue's evidence (the monitor uses it for the "Reappeared on" note); it
 * is merged after the audit's own evidence.
 */
export function auditFindingInputs(
  projectId: string,
  audit: AuditLike,
  extraEvidence?: (issueId: string) => Record<string, unknown> | null,
): AuditFindingInput[] {
  return audit.findings.map((finding) => {
    const { whyItMatters, recommendation } = explainFinding(finding);
    const extra = extraEvidence?.(finding.issueId) ?? null;
    return {
      projectId,
      source: "seo-audit",
      category: finding.category,
      severity: finding.severity === "Error" ? "critical" : "warning",
      entityType: "page-issue",
      entityId: finding.issueId,
      url: audit.url,
      evidence: { label: finding.label, whyItMatters, ...finding.evidence, ...(extra ?? {}) },
      recommendation,
    };
  });
}

/** Saves each input through the given store upsert, in order. The store decides the status transition. */
export async function saveAuditFindings(
  upsert: (input: AuditFindingInput) => Promise<unknown>,
  inputs: AuditFindingInput[],
): Promise<number> {
  for (const input of inputs) await upsert(input);
  return inputs.length;
}
