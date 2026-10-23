import {
  mergeOutreachTags,
  outreachCreditCost,
  type OutreachBlockReason,
  type OutreachPlanResponse,
  type OutreachSendResult,
  type OutreachStatus,
} from "./outreachContract.ts";

/**
 * Pure UI state logic for the lead outreach flow (recipients -> write -> review -> send -> results).
 * No React, no fetch: the panel renders what these functions return, so the rules are unit-tested.
 */

/* ---------------------------------------------------------------- reasons */

export const REASON_LABELS: Record<OutreachBlockReason, string> = {
  no_email: "No email address",
  guessed: "Guessed address",
  unsubscribed: "Unsubscribed",
  recent: "Emailed in the last 30 days",
  over_cap: "Over today's limit",
};

export function reasonLabel(reason: OutreachBlockReason | string | undefined): string {
  if (!reason) return "Not sent";
  return (REASON_LABELS as Record<string, string>)[reason] ?? "Not sent";
}

export type ReasonTone = "neutral" | "warn" | "danger" | "info";
export function reasonTone(reason: OutreachBlockReason): ReasonTone {
  if (reason === "unsubscribed") return "danger";
  if (reason === "guessed") return "warn";
  if (reason === "over_cap") return "info";
  return "neutral";
}

/* ------------------------------------------------------------- plan summary */

export type PlanSummary = {
  selected: number;
  sendable: number;
  blocked: number;
  headline: string;
  creditLine: string;
  /** Blocked leads grouped by reason, most common first. */
  reasonCounts: Array<{ reason: OutreachBlockReason; count: number }>;
  /** Share of the daily limit already used, 0..100. */
  meterPercent: number;
  meterLabel: string;
  canContinue: boolean;
};

export function meterLabel(status: OutreachStatus): string {
  return `${status.sentToday} of ${status.dailyCap} sent today, ${status.remainingToday} left`;
}

export function meterPercent(status: OutreachStatus): number {
  if (status.dailyCap <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((status.sentToday / status.dailyCap) * 100)));
}

export function creditLine(credits: number): string {
  if (credits <= 0) return "No credits needed (beta: not charged)";
  return `Costs about ${credits} credit${credits === 1 ? "" : "s"} (beta: not charged)`;
}

export function summarisePlan(selected: number, plan: OutreachPlanResponse): PlanSummary {
  const sendable = plan.sendable.length;
  const blocked = plan.blocked.length;
  const counts = new Map<OutreachBlockReason, number>();
  for (const b of plan.blocked) counts.set(b.reason, (counts.get(b.reason) ?? 0) + 1);
  return {
    selected,
    sendable,
    blocked,
    headline: `${selected} selected: ${sendable} will be sent, ${blocked} blocked`,
    creditLine: creditLine(plan.creditCost),
    reasonCounts: [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    meterPercent: meterPercent(plan.status),
    meterLabel: meterLabel(plan.status),
    canContinue: sendable > 0,
  };
}

export function guessedCheckboxLabel(count: number): string {
  return `Include ${count} guessed address${count === 1 ? "" : "es"} (they may bounce)`;
}

/* ------------------------------------------------------------ subject advice */

export type TextWarning = { id: "long" | "caps" | "exclaim" | "spammy" | "unknown_tag"; message: string };

export const SUBJECT_SOFT_LIMIT = 60;
const SPAMMY_PHRASES = ["act now", "100% free", "guaranteed", "winner", "click here", "buy now", "limited time"];
const KNOWN_TAGS = new Set(["name", "company", "title"]);

/** Share of letters that are upper case (0..1) and the letter count. */
export function upperRatio(text: string): { ratio: number; letters: number } {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return { ratio: 0, letters: 0 };
  const upper = letters.filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length;
  return { ratio: upper / letters.length, letters: letters.length };
}

/** Merge-tag-looking text that is not one of the three real tags (typos, spaces inside the braces). */
export function unknownMergeTags(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{[^{}]*\}\}/g)) {
    const inner = m[0].slice(2, -2);
    if (!KNOWN_TAGS.has(inner)) found.add(m[0]);
  }
  return [...found];
}

/**
 * Gentle guidance for the subject line. `sample` is a lead used to measure the length after merge tags
 * are filled in. Missing merge tags are fine, so they never warn.
 */
export function subjectWarnings(subject: string, sample?: { name?: string | null; company?: string | null; title?: string | null }): TextWarning[] {
  const out: TextWarning[] = [];
  const merged = sample ? mergeOutreachTags(subject, sample) : subject;
  if (merged.trim().length > SUBJECT_SOFT_LIMIT) {
    out.push({ id: "long", message: `${merged.trim().length} characters. Under about ${SUBJECT_SOFT_LIMIT} reads better on phones.` });
  }
  const { ratio, letters } = upperRatio(merged);
  if (letters >= 8 && ratio > 0.6) out.push({ id: "caps", message: "Mostly capital letters can look like spam. Try normal sentence case." });
  if (/!{2,}/.test(subject) || (subject.match(/!/g) ?? []).length >= 3) {
    out.push({ id: "exclaim", message: "Several exclamation marks can look like spam. One at most." });
  }
  const lower = subject.toLowerCase();
  if (SPAMMY_PHRASES.some((p) => lower.includes(p))) out.push({ id: "spammy", message: 'Phrases like "act now" or "guaranteed" often land in spam.' });
  const unknown = unknownMergeTags(subject);
  if (unknown.length) out.push({ id: "unknown_tag", message: `${unknown.join(", ")} is not a merge tag and will be sent as typed.` });
  return out;
}

export function bodyWarnings(body: string): TextWarning[] {
  const unknown = unknownMergeTags(body);
  return unknown.length ? [{ id: "unknown_tag", message: `${unknown.join(", ")} is not a merge tag and will be sent as typed.` }] : [];
}

/** How many of `leads` have an empty value for a merge tag used in `text` (the tag would render blank). */
export function blankTagCount(text: string, leads: Array<{ name?: string | null; company?: string | null; title?: string | null }>): number {
  const used = (["name", "company", "title"] as const).filter((k) => text.includes(`{{${k}}}`));
  if (used.length === 0) return 0;
  return leads.filter((l) => used.some((k) => !l[k]?.trim())).length;
}

/* ------------------------------------------------------------- merge tags */

export const MERGE_TAGS = ["{{name}}", "{{company}}", "{{title}}"] as const;

/** Inserts `tag` replacing the selection [start, end); returns the new text and where the cursor goes. Out-of-range cursors append. */
export function insertAtCursor(text: string, tag: string, start: number | null | undefined, end: number | null | undefined): { text: string; cursor: number } {
  const s = start == null || start < 0 || start > text.length ? text.length : start;
  const e = end == null || end < s || end > text.length ? s : end;
  return { text: text.slice(0, s) + tag + text.slice(e), cursor: s + tag.length };
}

/* ----------------------------------------------------------- step machine */

export type Step = "recipients" | "compose" | "review" | "sending" | "results";
export type StepperStop = { id: "recipients" | "compose" | "review"; label: string };
export const STEPPER: StepperStop[] = [
  { id: "recipients", label: "Recipients" },
  { id: "compose", label: "Write" },
  { id: "review", label: "Preview & send" },
];

/** Which of the three stepper stops is current (sending and results belong to the last one). */
export function stepperIndex(step: Step): number {
  return step === "recipients" ? 0 : step === "compose" ? 1 : 2;
}

export type FlowState = {
  step: Step;
  /** Where to return if a send attempt fails as a whole (a normal send comes from review, a retry from results). */
  returnTo: "review" | "results";
};
export type FlowAction = { type: "next" } | { type: "back" } | { type: "submit" } | { type: "retry" } | { type: "done" } | { type: "fail" };

export const initialFlow: FlowState = { step: "recipients", returnTo: "review" };

/**
 * Moves are guarded: "submit" only works from review and "retry" only from results, and neither works while a
 * send is in flight, so a double click can never fire two requests. The caller sends only when the step changed.
 */
export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "next":
      return state.step === "recipients" ? { ...state, step: "compose" } : state.step === "compose" ? { ...state, step: "review" } : state;
    case "back":
      return state.step === "compose" ? { ...state, step: "recipients" } : state.step === "review" ? { ...state, step: "compose" } : state;
    case "submit":
      return state.step === "review" ? { step: "sending", returnTo: "review" } : state;
    case "retry":
      return state.step === "results" ? { step: "sending", returnTo: "results" } : state;
    case "done":
      return state.step === "sending" ? { ...state, step: "results" } : state;
    case "fail":
      return state.step === "sending" ? { ...state, step: state.returnTo } : state;
  }
}

export function canReview(subject: string, body: string): boolean {
  return subject.trim().length > 0 && body.trim().length > 0;
}

/* ----------------------------------------------------------------- results */

type ResultRow = OutreachSendResult["results"][number];

export type ResultsSummary = { sent: number; failed: number; skipped: number; total: number };

export function summariseResults(results: ResultRow[]): ResultsSummary {
  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  return { sent, failed, skipped, total: results.length };
}

/** Only failed sends are retried. Skipped ones were blocked by a rule, so retrying cannot help. */
export function retryIds(results: ResultRow[]): string[] {
  return results.filter((r) => r.status === "failed").map((r) => r.id);
}

/** Keeps earlier results and replaces rows that were retried. */
export function mergeResults(previous: ResultRow[], next: ResultRow[]): ResultRow[] {
  const byId = new Map(next.map((r) => [r.id, r]));
  const merged = previous.map((r) => byId.get(r.id) ?? r);
  const known = new Set(previous.map((r) => r.id));
  return [...merged, ...next.filter((r) => !known.has(r.id))];
}

/** Plain-language text for one non-sent row. */
export function resultReason(row: ResultRow): string {
  if (row.status === "skipped") return reasonLabel(row.reason);
  return row.error?.trim() || "Gmail could not send this one";
}

export function sendingText(count: number): string {
  return `Sending ${count} email${count === 1 ? "" : "s"}. Keep this panel open.`;
}

/* ------------------------------------------------------------------ errors */

/** Calm, plain messages for failed outreach calls. Never raw JSON. */
export function outreachErrorMessage(status: number, serverMessage?: string | null): string {
  if (status === 503) return "Outreach safeguards are not set up yet, so nothing was sent. Try again later.";
  if (status === 422) {
    const detail = serverMessage?.trim();
    return detail && !detail.startsWith("{") ? `Nothing was sent. ${detail}` : "Nothing was sent. Check that Gmail is connected and try again.";
  }
  if (status === 0) return "Couldn't reach the server. Check your connection and try again.";
  if (status === 401 || status === 403) return "You're signed out or don't have access. Sign in again and retry.";
  if (status === 429) return "Too many requests right now. Wait a moment and try again.";
  return "Something went wrong on our side. Nothing was sent. Try again in a moment.";
}

/* ---------------------------------------------------------- sender profile */

export type SenderProfile = { name: string; company: string; address: string };
export const EMPTY_SENDER: SenderProfile = { name: "", company: "", address: "" };
export const SENDER_STORAGE_KEY = "marlo.outreach.sender.v1";

/** Parses what was stored; anything unexpected becomes an empty profile. */
export function parseSenderProfile(raw: string | null | undefined): SenderProfile {
  if (!raw) return EMPTY_SENDER;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof SenderProfile, unknown>> | null;
    if (!v || typeof v !== "object") return EMPTY_SENDER;
    const str = (x: unknown) => (typeof x === "string" ? x.slice(0, 200) : "");
    return { name: str(v.name), company: str(v.company), address: str(v.address) };
  } catch {
    return EMPTY_SENDER;
  }
}

export function creditsFor(emails: number): number {
  return outreachCreditCost(emails);
}
