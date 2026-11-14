// Types and pure helpers that are safe in the browser (no node:crypto). publicReport.ts re-exports them.

export type ReportFinding = {
  issueId: string;
  category: string;
  severity: "Warning" | "Error";
  label: string;
  evidence: Record<string, string | number | null>;
  whyItMatters: string;
  recommendation: string;
};

/** A business shown as a teaser under an audit: what exists, never the contact itself. */
export type PublicLead = {
  name: string;
  host: string;
  fitReason: string;
  channels: Array<"email" | "whatsapp" | "form">;
};

export type ScoreBand = "strong" | "good" | "needs-work" | "weak";

/** Plain words for the on-page score. It is a checklist percentage, not a ranking prediction. */
export function scoreBand(score: number): { band: ScoreBand; label: string } {
  if (score >= 90) return { band: "strong", label: "Strong" };
  if (score >= 70) return { band: "good", label: "Good" };
  if (score >= 50) return { band: "needs-work", label: "Needs work" };
  return { band: "weak", label: "Weak" };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.length > 80 ? url.slice(0, 80) : url;
  }
}
