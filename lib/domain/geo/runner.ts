import { analyzeAnswer, dayOf, type Subject } from "./visibility.ts";
import { promptsThatFit, remainingRuns, runsPerPromptFor } from "./dailyCap.ts";
import type { AnswerPort } from "./engines.ts";
import { ASK_TIMEOUT_MS, classifyFailure, isRepeatingFailure, withTimeout, type FailureCode } from "./providerError.ts";
import { RUNS_PER_PROMPT, type AnswerMethod, type GeoRunRow } from "./types.ts";

export type RunStore = {
  /** Runs already stored for this prompt + method on this UTC day. */
  countRuns(prompt: string, method: AnswerMethod, date: string): Promise<number>;
  /** Calls used by this user for this method today (failed calls included), for the daily cap. */
  countMethodRunsToday(method: AnswerMethod, date: string): Promise<number>;
  /**
   * Atomically take one call slot against the user's daily cap before the call
   * is made. Returns false (and takes nothing) when the cap is used up.
   */
  reserve(method: AnswerMethod, date: string, cap: number): Promise<boolean>;
  /** Per-project in-flight guard. False when another run holds it. */
  tryLock(ttlMs: number): Promise<boolean>;
  unlock(): Promise<void>;
  saveRuns(rows: GeoRunRow[]): Promise<void>;
};

export type SkipReason = "cap" | "rotation" | "budget" | "provider";

export type SkippedPrompt = { prompt: string; method: AnswerMethod; reason: SkipReason };

export type RunSummary = {
  ran: number;
  skippedAlreadyDone: number;
  skippedCap: number;
  skippedBudget: number;
  /** One entry per failed call. `error` repeats `message` for older readers. */
  failed: Array<{ prompt: string; method: AnswerMethod; code: FailureCode; message: string; error: string }>;
  /** Checks this run was asked to hold (prompts x runs per prompt, rotation-skipped prompts excluded) and how many exist now, stored earlier today or just run. */
  target: number;
  completed: number;
  /** Time budget: its length and whether the run stopped on it. */
  budget: { limitMs: number; exhausted: boolean };
  /** Which prompts were not (fully) run and why. Rotation = the daily cap is smaller than the prompt list, so the start moves each day. */
  skipped: SkippedPrompt[];
  /** Runs per prompt actually targeted per method (lower than 3 when the daily cap is small). */
  runsPerPrompt: Partial<Record<AnswerMethod, number>>;
  /** True when another run for this project was already in flight and nothing was done. */
  inFlight?: boolean;
};

export const DEFAULT_BUDGET_MS = 45_000;

export function emptySummary(budgetMs = DEFAULT_BUDGET_MS): RunSummary {
  return {
    ran: 0, skippedAlreadyDone: 0, skippedCap: 0, skippedBudget: 0, failed: [], skipped: [], runsPerPrompt: {},
    target: 0, completed: 0, budget: { limitMs: budgetMs, exhausted: false },
  };
}

/** After this many failures in a row that will repeat (bad key, quota, 4xx), a method is stopped for the run. */
const STOP_AFTER_CONSECUTIVE = 2;

const EXCERPT_CHARS = 400;
const LOCK_TTL_MS = 120_000;

/** Rotate the list so the starting prompt changes each UTC day. */
export function rotateByDay<T>(items: T[], date: string): T[] {
  if (items.length === 0) return items;
  const dayNumber = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const offset = ((dayNumber % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/**
 * Run every prompt up to RUNS_PER_PROMPT times per port. Idempotent per UTC
 * day: runs already stored today count, so a retry adds nothing extra.
 *
 * Daily caps (`caps`, method -> max calls per day, null/absent = unlimited):
 * a slot is reserved atomically BEFORE each call, so concurrent runs cannot
 * overshoot, and failed calls still count. When the cap is smaller than
 * prompts x 3, runs per prompt drop (never below 1) and, if even that does not
 * fit, the starting prompt rotates by day; every skipped prompt is reported.
 * A per-project lock stops double clicks and cron overlap from double-running.
 * Each ask has its own time limit and each successful row is saved at once, so
 * a hung call loses at most itself. Two repeating failures in a row (rejected
 * key, quota, 4xx) stop that method for the rest of the run so slots are kept.
 */
export async function runGeoPrompts(args: {
  prompts: string[];
  ports: AnswerPort[];
  subject: Subject;
  store: RunStore;
  caps?: Partial<Record<AnswerMethod, number | null>>;
  now?: () => Date;
  budgetMs?: number;
  clock?: () => number;
  /** Per-ask time limit (default 15s). */
  askTimeoutMs?: number;
  /** Upper bound on runs per prompt per day (default 3). The weekly cron uses 1. */
  maxRunsPerPrompt?: number;
}): Promise<RunSummary> {
  const now = args.now ?? (() => new Date());
  const clock = args.clock ?? Date.now;
  const deadline = clock() + (args.budgetMs ?? DEFAULT_BUDGET_MS);
  const summary = emptySummary(args.budgetMs ?? DEFAULT_BUDGET_MS);
  const askTimeoutMs = args.askTimeoutMs ?? ASK_TIMEOUT_MS;
  const today = dayOf(now().toISOString());

  if (!(await args.store.tryLock(LOCK_TTL_MS))) {
    summary.inFlight = true;
    return summary;
  }
  try {
    for (const port of args.ports) {
      const cap = args.caps?.[port.method] ?? null;
      const perPrompt = runsPerPromptFor(cap, args.prompts.length, Math.min(RUNS_PER_PROMPT, args.maxRunsPerPrompt ?? RUNS_PER_PROMPT));
      summary.runsPerPrompt[port.method] = perPrompt;
      const fit = promptsThatFit(cap, args.prompts.length, perPrompt);
      const ordered = fit < args.prompts.length ? rotateByDay(args.prompts, today) : args.prompts;
      const startLeft = remainingRuns(cap, await args.store.countMethodRunsToday(port.method, today));
      let consecutiveRepeating = 0;

      for (const [index, prompt] of ordered.entries()) {
        if (index >= fit) {
          summary.skipped.push({ prompt, method: port.method, reason: "rotation" });
          continue;
        }
        const need = perPrompt - (await args.store.countRuns(prompt, port.method, today));
        summary.target += perPrompt;
        summary.completed += perPrompt - Math.max(0, need);
        if (consecutiveRepeating >= STOP_AFTER_CONSECUTIVE && need > 0) {
          summary.skipped.push({ prompt, method: port.method, reason: "provider" });
          continue;
        }
        if (need <= 0) {
          summary.skippedAlreadyDone += 1;
          continue;
        }
        if (clock() >= deadline) {
          summary.budget.exhausted = true;
          summary.skippedBudget += 1;
          summary.skipped.push({ prompt, method: port.method, reason: "budget" });
          continue;
        }
        if (startLeft !== null && startLeft <= 0) {
          summary.skippedCap += 1;
          summary.skipped.push({ prompt, method: port.method, reason: "cap" });
          continue;
        }
        let stopped: SkipReason | null = null;
        for (let i = 0; i < need; i += 1) {
          if (clock() >= deadline) {
            summary.budget.exhausted = true;
            stopped = "budget";
            break;
          }
          if (cap !== null && !(await args.store.reserve(port.method, today, cap))) {
            stopped = "cap";
            break;
          }
          try {
            const result = await withTimeout(port.ask(prompt), askTimeoutMs);
            const a = analyzeAnswer(result, args.subject);
            // Saved as soon as it exists: a later hang or crash cannot lose it.
            await args.store.saveRuns([
              {
                prompt,
                engine: port.engine,
                method: port.method,
                runAt: now().toISOString(),
                mentioned: a.mentioned,
                cited: a.cited,
                competitors: a.competitors,
                sources: result.citedUrls.slice(0, 10),
                answerExcerpt: result.answer.slice(0, EXCERPT_CHARS),
              },
            ]);
            summary.ran += 1;
            summary.completed += 1;
            consecutiveRepeating = 0;
          } catch (err) {
            const { code, message } = classifyFailure(err);
            summary.failed.push({ prompt, method: port.method, code, message, error: message });
            consecutiveRepeating = isRepeatingFailure(code) ? consecutiveRepeating + 1 : 0;
            break;
          }
        }
        if (stopped === "cap") summary.skippedCap += 1;
        if (stopped === "budget") summary.skippedBudget += 1;
        if (stopped) summary.skipped.push({ prompt, method: port.method, reason: stopped });
      }
    }
  } finally {
    await args.store.unlock();
  }
  return summary;
}

const METHOD_LABEL: Record<AnswerMethod, string> = { "gemini-grounded": "Gemini", simulated: "The simulated check (Tavily + Groq)" };

function failureSentence(method: AnswerMethod, code: FailureCode, message: string): string {
  const who = METHOD_LABEL[method];
  switch (code) {
    case "auth":
      return `${who} key rejected: check Settings`;
    case "rate_limit":
      return `${who} rate limit or quota reached: try again later`;
    case "client":
      return `${who} refused the request: check Settings`;
    case "timeout":
      return `${who} did not answer in time`;
    case "network":
    case "server":
      return `${who} is unavailable right now`;
    case "empty":
      return `${who} returned an empty answer`;
    default:
      return `${who} failed: ${message}`;
  }
}

export type RunOutcome = { level: "ok" | "partial" | "failed" | "busy" | "nothing"; message: string };

/**
 * The one sentence a person sees after a run: what was checked, what failed and why.
 * "Nothing to run" is reserved for a run that really had nothing to do; a run where every call failed says so.
 */
export function summariseRun(summary: RunSummary): RunOutcome {
  if (summary.inFlight) return { level: "busy", message: "A check is already running for this project. Try again in a minute." };
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const f of summary.failed) {
    const key = `${f.method}:${f.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reasons.push(failureSentence(f.method, f.code, f.message));
  }
  if (summary.target === 0 && summary.failed.length === 0) return { level: "nothing", message: "Nothing to run." };
  if (summary.ran === 0 && summary.failed.length > 0) {
    return { level: "failed", message: `No checks ran. ${reasons.join(". ")}.` };
  }
  const notes = [...reasons];
  if (summary.skipped.some((x) => x.reason === "provider")) notes.push("stopped early to save your daily checks");
  if (summary.skippedCap > 0) notes.push("daily limit reached");
  if (summary.budget.exhausted) notes.push("stopped at the time limit; run again to finish");
  const base = `${summary.completed} of ${summary.target} checked`;
  const level = summary.completed >= summary.target && notes.length === 0 ? "ok" : "partial";
  return { level, message: notes.length > 0 ? `${base}. ${notes[0][0].toUpperCase()}${notes[0].slice(1)}${notes.slice(1).map((n) => `; ${n}`).join("")}.` : base };
}
