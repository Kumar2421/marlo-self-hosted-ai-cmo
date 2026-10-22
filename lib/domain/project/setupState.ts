/** Persisted project-setup state: the step list, the transition rules and the
 * "what is left to run" decision. Pure (no fetch, no DB, no React) so the same
 * rules drive the server route, both stores and the client resume, and are
 * testable. Complements setupRun.ts (which words the run summary). */

import type { DocKey } from "./setupRun.ts";

export type SetupStepKey = "audit" | "description" | "competitors" | "leads" | DocKey;

/** Execution order. Mirrors project-store.tsx: crawl, description, competitors, leads, then the documents. */
export const SETUP_STEPS: readonly SetupStepKey[] = [
  "audit",
  "description",
  "competitors",
  "leads",
  "product-info",
  "marketing-strategy",
  "competitor-analysis",
  "competitor-comparison",
  "content-strategy",
  "design-guide",
];

export const SETUP_STEP_LABELS: Record<SetupStepKey, string> = {
  audit: "Site audit",
  description: "Description",
  competitors: "Competitors",
  leads: "Starter leads",
  "product-info": "Product Information",
  "marketing-strategy": "Marketing Strategy",
  "competitor-analysis": "Competitor Analysis",
  "competitor-comparison": "Competitor Comparison",
  "content-strategy": "Content Strategy",
  "design-guide": "Design Guide",
};

export type SetupStatus = "pending" | "running" | "done" | "failed" | "skipped";
const STATUSES: readonly SetupStatus[] = ["pending", "running", "done", "failed", "skipped"];

export type SetupStepState = { status: SetupStatus; at: string; error?: string };

export type SetupState = {
  steps: Record<SetupStepKey, SetupStepState>;
  /** Null for a project whose state was only derived from existing rows (never run by setup). */
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

/** A running step older than this was left behind by a closed or crashed tab. */
export const STALE_RUNNING_MS = 10 * 60 * 1000;

export function isSetupStepKey(v: unknown): v is SetupStepKey {
  return typeof v === "string" && (SETUP_STEPS as readonly string[]).includes(v);
}
export function isSetupStatus(v: unknown): v is SetupStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

/** What each step needs to have succeeded first. Documents reuse the prerequisites
 * from setupRun.ts; everything needs the crawl, as in the creation flow. */
const NEEDS: Partial<Record<SetupStepKey, SetupStepKey[]>> = {
  description: ["audit"],
  competitors: ["audit"],
  leads: ["audit"],
  "product-info": ["audit"],
  "marketing-strategy": ["audit", "product-info"],
  "competitor-analysis": ["audit"],
  "competitor-comparison": ["audit"],
  "content-strategy": ["audit", "product-info"],
  "design-guide": ["audit", "product-info", "marketing-strategy"],
};

export function newSetupState(now: Date, started: boolean): SetupState {
  const at = now.toISOString();
  const steps = {} as Record<SetupStepKey, SetupStepState>;
  for (const k of SETUP_STEPS) steps[k] = { status: "pending", at };
  return { steps, startedAt: started ? at : null, finishedAt: null, updatedAt: at };
}

/** Coerces stored JSON to a full state: unknown keys dropped, missing/invalid steps become pending. */
export function normalizeSetupState(raw: unknown, now: Date): SetupState {
  const base = newSetupState(now, false);
  const r = (raw ?? {}) as Partial<SetupState>;
  const src = (r.steps ?? {}) as Record<string, Partial<SetupStepState> | undefined>;
  for (const k of SETUP_STEPS) {
    const s = src[k];
    if (s && isSetupStatus(s.status)) {
      base.steps[k] = { status: s.status, at: typeof s.at === "string" ? s.at : base.updatedAt };
      if (typeof s.error === "string" && s.error) base.steps[k].error = s.error;
    }
  }
  base.startedAt = typeof r.startedAt === "string" ? r.startedAt : null;
  base.finishedAt = typeof r.finishedAt === "string" ? r.finishedAt : null;
  base.updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : base.updatedAt;
  return base;
}

/** True when a step is marked running but nobody has touched it for STALE_RUNNING_MS. */
export function isStale(step: SetupStepState, now: Date): boolean {
  if (step.status !== "running") return false;
  const t = Date.parse(step.at);
  return !Number.isFinite(t) || now.getTime() - t > STALE_RUNNING_MS;
}

/** A step that some tab is (probably) running right now. */
export function isFreshRunning(step: SetupStepState, now: Date): boolean {
  return step.status === "running" && !isStale(step, now);
}

export function anyFreshRunning(state: SetupState, now: Date): boolean {
  return SETUP_STEPS.some((k) => isFreshRunning(state.steps[k], now));
}

export type Transition = { step: SetupStepKey; status: SetupStatus; error?: string; retry?: boolean };
export type TransitionResult =
  | { ok: true; state: SetupState }
  | { ok: false; reason: "conflict" | "invalid"; message: string };

/** Applies one step transition. Rules:
 * - finished steps (done/skipped) only change with an explicit retry (-> pending/running);
 * - a step another tab is running (fresh) cannot be claimed again (conflict); it can be
 *   settled (done/failed/skipped) by whoever reports it;
 * - "pending" is only reachable from failed/stale-running/skipped/done via retry. */
export function applyTransition(state: SetupState, t: Transition, now: Date): TransitionResult {
  if (!isSetupStepKey(t.step) || !isSetupStatus(t.status)) return { ok: false, reason: "invalid", message: "Unknown step or status." };
  const cur = state.steps[t.step];
  const finished = cur.status === "done" || cur.status === "skipped";
  const claiming = t.status === "running";

  if (claiming && isFreshRunning(cur, now)) return { ok: false, reason: "conflict", message: "Another tab is already running this step." };
  if (finished && t.status !== cur.status && !t.retry) {
    return { ok: false, reason: "conflict", message: `${t.step} is already ${cur.status}; pass retry to redo it.` };
  }
  if (finished && t.status === cur.status) return { ok: true, state }; // idempotent re-report
  if (t.status === "pending" && cur.status === "running" && !isStale(cur, now) && !t.retry) {
    return { ok: false, reason: "conflict", message: "Step is running." };
  }

  const at = now.toISOString();
  const next: SetupState = { ...state, steps: { ...state.steps, [t.step]: { status: t.status, at } }, updatedAt: at };
  if (t.status === "failed" && t.error) next.steps[t.step].error = t.error.slice(0, 300);
  if (t.status === "pending" && t.error) next.steps[t.step].error = t.error.slice(0, 300);
  if (!next.startedAt) next.startedAt = at;
  next.finishedAt = nextStepsToRun(next, now).length === 0 && !anyFreshRunning(next, now) ? at : null;
  return { ok: true, state: next };
}

/** The failed/blocked source of `key`, or null when it may run. A source counts
 * only when it is failed (a pending/running source will be run first, in order). */
function failedSource(state: SetupState, key: SetupStepKey): SetupStepKey | null {
  for (const need of NEEDS[key] ?? []) if (state.steps[need].status === "failed") return need;
  return null;
}

/** Steps a resume should run, in order: pending and interrupted (stale running).
 * Failed steps are retried only with `retryFailed`; a step whose source failed is
 * left out (running it would produce ungrounded output). */
export function nextStepsToRun(state: SetupState, now: Date, opts: { retryFailed?: boolean } = {}): SetupStepKey[] {
  const out: SetupStepKey[] = [];
  for (const k of SETUP_STEPS) {
    const s = state.steps[k];
    const runnable = s.status === "pending" || isStale(s, now) || (opts.retryFailed === true && s.status === "failed");
    if (!runnable) continue;
    if (!opts.retryFailed && failedSource(state, k)) continue;
    out.push(k);
  }
  return out;
}

export function blockingSource(state: SetupState, key: SetupStepKey): SetupStepKey | null {
  return failedSource(state, key);
}

export type SetupSummary = {
  done: number;
  total: number;
  failed: number;
  running: boolean;
  text: string;
};

/** "4 of 10 ready" (+ failure count). Skipped steps are not counted toward the total. */
export function summarizeSetup(state: SetupState, now: Date): SetupSummary {
  const counted = SETUP_STEPS.filter((k) => state.steps[k].status !== "skipped");
  const done = counted.filter((k) => state.steps[k].status === "done").length;
  const failed = counted.filter((k) => state.steps[k].status === "failed").length;
  const running = anyFreshRunning(state, now);
  let text = `${done} of ${counted.length} ready`;
  if (failed) text += `, ${failed} failed`;
  return { done, total: counted.length, failed, running, text };
}

/** A setup run left unfinished by a closed tab: it was started, and steps remain to run. */
export function isUnfinished(state: SetupState, now: Date): boolean {
  return state.startedAt !== null && nextStepsToRun(state, now).length > 0;
}

export type SetupFacts = {
  hasAudit: boolean;
  hasDescription: boolean;
  hasCompetitors: boolean;
  /** Document keys that already have saved content. */
  documents: DocKey[];
};

/** State for a project that has none stored (created before this table, or
 * lost). Built from existing rows, never started (startedAt null) so it is not
 * auto-resumed: a complete project reads as done, an incomplete one shows the
 * missing steps with Retry buttons. */
export function deriveSetupState(f: SetupFacts, now: Date): SetupState {
  const state = newSetupState(now, false);
  const at = now.toISOString();
  const set = (k: SetupStepKey, status: SetupStatus) => (state.steps[k] = { status, at });
  if (f.hasAudit) set("audit", "done");
  if (f.hasDescription) set("description", "done");
  if (f.hasCompetitors) set("competitors", "done");
  for (const k of SETUP_STEPS) if ((f.documents as string[]).includes(k)) set(k, "done");
  // Leads are never derived from rows: treat a project with documents as past that stage.
  if (f.documents.length > 0) set("leads", "done");
  if (!f.hasCompetitors && f.documents.includes("product-info")) {
    // Setup got as far as writing documents, so competitor discovery ran and found none.
    set("competitors", "done");
    if (state.steps["competitor-analysis"].status === "pending") set("competitor-analysis", "skipped");
    if (state.steps["competitor-comparison"].status === "pending") set("competitor-comparison", "skipped");
  }
  state.finishedAt = nextStepsToRun(state, now).length === 0 ? at : null;
  return state;
}

export function docTypeOf(key: DocKey): string {
  return key.replace(/-/g, "_");
}
const DOC_KEYS: readonly string[] = [
  "product-info",
  "marketing-strategy",
  "competitor-analysis",
  "competitor-comparison",
  "content-strategy",
  "design-guide",
];
export function docKeyOfType(docType: string): DocKey | null {
  const k = docType.replace(/_/g, "-");
  return DOC_KEYS.includes(k) ? (k as DocKey) : null;
}

/** Prefix of the note stored on a pending step that was not attempted because its source failed. */
export const WAITING_PREFIX = "waiting on ";

const OPTIONAL_STEPS: readonly SetupStepKey[] = ["competitors", "leads", "competitor-analysis", "competitor-comparison"];

export type SetupCardRow = {
  key: SetupStepKey;
  label: string;
  optional: boolean;
  /** failed: errored. interrupted: left running by a closed tab. pending: not run yet. waiting: its source failed. */
  kind: "failed" | "interrupted" | "pending" | "waiting";
  note: string;
  /** Waiting steps have nothing to retry until their source succeeds. */
  canRun: boolean;
};

/** What the "Finish setup" card lists: every step that is not done/skipped/running, truthfully. */
export function setupCardRows(state: SetupState, now: Date): SetupCardRow[] {
  const rows: SetupCardRow[] = [];
  for (const k of SETUP_STEPS) {
    const s = state.steps[k];
    if (s.status === "done" || s.status === "skipped" || isFreshRunning(s, now)) continue;
    const source = s.status === "pending" ? failedSource(state, k) : null;
    const kind: SetupCardRow["kind"] = source ? "waiting" : s.status === "failed" ? "failed" : s.status === "running" ? "interrupted" : "pending";
    const note =
      kind === "waiting" ? `Waiting on ${SETUP_STEP_LABELS[source!]}` : kind === "failed" ? (s.error ?? "Didn't finish") : kind === "interrupted" ? "Interrupted" : "Not run yet";
    rows.push({ key: k, label: SETUP_STEP_LABELS[k], optional: OPTIONAL_STEPS.includes(k), kind, note, canRun: kind !== "waiting" });
  }
  return rows;
}

/** True when a required step still needs attention (drives whether the card shows). */
export function needsSetupAttention(rows: SetupCardRow[]): boolean {
  return rows.some((r) => !r.optional);
}
