/** "Finish setup" checklist, derived from rows that already exist (no new
 * table, no persisted setup state). Shown in Context only when something is
 * missing, so a fully set-up project sees nothing. */

export type SetupStepId = "audit" | "description" | "documents" | "competitors";

export type SetupStep = {
  id: SetupStepId;
  label: string;
  /** Label of the retry button. */
  action: string;
  /** Optional steps are suggestions, not problems. */
  optional: boolean;
};

export type SetupFacts = {
  auditCount: number;
  description: string | null | undefined;
  documentCount: number;
  competitorCount: number;
};

export function deriveSetupChecklist(f: SetupFacts): SetupStep[] {
  const steps: SetupStep[] = [];
  if (f.auditCount === 0) steps.push({ id: "audit", label: "Run the site audit", action: "Run audit", optional: false });
  if (!f.description || !f.description.trim()) {
    steps.push({ id: "description", label: "Generate description", action: "Generate", optional: false });
  }
  if (f.documentCount === 0) steps.push({ id: "documents", label: "Generate documents", action: "Generate", optional: false });
  if (f.competitorCount === 0) steps.push({ id: "competitors", label: "Add competitors (optional)", action: "Find", optional: true });
  return steps;
}

const normUrl = (u: unknown) =>
  typeof u === "string" ? u.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase() : "";

/** Real on-page score of the newest audit for `projectUrl` (or the newest
 * audit when no URL matches), or null when there is none. Rows come straight
 * from the dashboard dataset: `payload` is an object on hosted and a JSON
 * string on self-host. Never invents a number. */
export function latestOnPageScore(
  rows: Array<Record<string, unknown>>,
  projectUrl?: string | null,
): number | null {
  const sorted = [...rows].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const matching = projectUrl ? sorted.filter((r) => normUrl(r.url) === normUrl(projectUrl)) : [];
  for (const row of matching.length ? matching : sorted) {
    let payload: unknown = row.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        continue;
      }
    }
    const score = (payload as { technical?: { onPageScore?: unknown } } | null)?.technical?.onPageScore;
    if (typeof score === "number" && Number.isFinite(score)) return Math.round(score);
  }
  return null;
}
