/** Pure helpers for the project-setup run (lib/project-store.tsx): decide
 * whether a streamed document is safe to save, which documents must wait for a
 * prerequisite, and how to word the final summary. No fetches, no React, so the
 * rules are testable and the setup log never claims success it did not get. */

export type DocKey =
  | "product-info"
  | "marketing-strategy"
  | "competitor-analysis"
  | "competitor-comparison"
  | "content-strategy"
  | "design-guide";

export type DocOutcome = {
  key: DocKey;
  title: string;
  /** ready: saved. failed: attempted, not saved. blocked: not attempted because
   * a prerequisite failed. skipped: not applicable (e.g. no competitors yet). */
  status: "ready" | "failed" | "blocked" | "skipped";
};

/** Documents grounded in an earlier one (see each Generator). Without the
 * prerequisite the model runs on nothing and the result would be treated as
 * ground truth downstream, so the dependent is skipped, not generated weakly. */
const PREREQUISITES: Partial<Record<DocKey, DocKey[]>> = {
  "marketing-strategy": ["product-info"],
  "content-strategy": ["product-info"],
  "design-guide": ["product-info", "marketing-strategy"],
};

/** Title of the first failed/blocked prerequisite of `key`, or null when it may run. */
export function blockedBy(key: DocKey, outcomes: DocOutcome[]): string | null {
  for (const need of PREREQUISITES[key] ?? []) {
    const o = outcomes.find((x) => x.key === need);
    if (o && (o.status === "failed" || o.status === "blocked")) return o.title;
  }
  return null;
}

const DANGLING_WORDS = new Set(["and", "or", "the", "of", "to", "with", "a", "an", "in", "for", "that", "which", "is", "are"]);

/** Decides whether a streamed document looks complete enough to overwrite a
 * saved one. A gracefully truncated stream (model cut off, connection dropped)
 * ends without an error, so the only evidence is the text itself. Conservative:
 * rejecting a good document only costs a retry, saving a truncated one
 * destroys a good document. */
export function assessGeneratedDocument(text: string): { ok: true } | { ok: false; reason: string } {
  const t = text.trim();
  if (!t) return { ok: false, reason: "the model returned nothing" };
  if (t.length < 200) return { ok: false, reason: "the response was too short to be a full document" };
  if ((t.match(/^\s*```/gm) ?? []).length % 2 === 1) return { ok: false, reason: "the response was cut off inside a code block" };
  const lastLine = t.split("\n").filter((l) => l.trim()).pop()!.trim();
  if (lastLine.startsWith("|") && !lastLine.endsWith("|")) return { ok: false, reason: "the response was cut off inside a table" };
  if (/[,:;(–—-]$/.test(lastLine)) return { ok: false, reason: "the response was cut off mid-sentence" };
  const lastWord = lastLine.split(/\s+/).pop()?.toLowerCase() ?? "";
  if (DANGLING_WORDS.has(lastWord)) return { ok: false, reason: "the response was cut off mid-sentence" };
  return { ok: true };
}

export type DocumentRunSummary = {
  ready: number;
  total: number;
  failed: string[];
  blocked: string[];
  skipped: string[];
  hasProblems: boolean;
  text: string;
};

export function summarizeDocumentRun(outcomes: DocOutcome[]): DocumentRunSummary {
  const total = outcomes.length;
  const ready = outcomes.filter((o) => o.status === "ready").length;
  const titles = (s: DocOutcome["status"]) => outcomes.filter((o) => o.status === s).map((o) => o.title);
  const failed = titles("failed");
  const blocked = titles("blocked");
  const skipped = titles("skipped");
  const hasProblems = failed.length + blocked.length > 0;

  const parts = [`${ready} of ${total} documents ready`];
  if (failed.length) parts.push(`${failed.length} failed (${failed.join(", ")})`);
  if (blocked.length) parts.push(`${blocked.length} not attempted because an earlier document failed (${blocked.join(", ")})`);
  if (skipped.length) parts.push(`${skipped.length} skipped (${skipped.join(", ")}: no competitors yet)`);
  const text = parts.join(", ") + (hasProblems ? ": open Context to retry." : ".");
  return { ready, total, failed, blocked, skipped, hasProblems, text };
}

/** Which project's setup run is in flight (null when none). Only the project
 * that started a run may end it, so creating a second project while the first
 * run's documents are still writing cannot flip the first one's state early. */
export function settleSetupRun(runningProjectId: string | null, finishedProjectId: string): string | null {
  return runningProjectId === finishedProjectId ? null : runningProjectId;
}

/** True while the active project's setup run is in flight. Drives the Context
 * "Finish setup" card (hidden), the Analytics "Auditing..." state and the
 * disabled re-run buttons, so nothing offers to re-run work that is already running. */
export function isSetupRunning(runningProjectId: string | null, activeProjectId: string | undefined): boolean {
  return runningProjectId !== null && runningProjectId === activeProjectId;
}

/** Last line of setup. "Setup complete" only when nothing required went wrong. */
export function finalSetupLine(problems: string[]): { ok: boolean; text: string } {
  if (problems.length === 0) return { ok: true, text: "Setup complete — your dashboard is ready." };
  return { ok: false, text: `Setup finished with problems: ${problems.join("; ")}. Open Context to finish setup.` };
}
