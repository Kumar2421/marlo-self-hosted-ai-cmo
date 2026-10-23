/**
 * Pure decisions for the automatic PageSpeed re-measure: when to start, what is still missing, when to
 * retry, and how the route reports an outcome. No React, no network, no clock (callers inject them).
 */
import { isPageSpeedTimeout, type PageSpeedStrategy } from "./pageSpeedInsights.ts";
import type { PageSpeedCarrier } from "./pageSpeedFallback.ts";

export type PsiStatus = "measured" | "timeout" | "error" | "no_key";

export const PSI_STRATEGIES: readonly PageSpeedStrategy[] = ["mobile", "desktop"];

/** Calls per user and project per 10-minute window. The first attempt plus the 2-minute and 5-minute retries
 * are up to 3 attempts x 2 strategies = 6 calls, all inside one window; 4 would starve the last retry. */
export const PSI_RATE_LIMIT = { limit: 6, windowSec: 600 } as const;

/** Automatic retries while the page stays open, after the first attempt: 2 and 5 minutes. */
export const PSI_AUTO_RETRY_DELAYS_MS: readonly number[] = [2 * 60_000, 5 * 60_000];

/** Delay before automatic retry number `retriesDone + 1`, or null once they are used up. */
export function nextRetryDelayMs(retriesDone: number): number | null {
  return retriesDone >= 0 && retriesDone < PSI_AUTO_RETRY_DELAYS_MS.length ? PSI_AUTO_RETRY_DELAYS_MS[retriesDone] : null;
}

/** What the route answers for a failed PageSpeed call. Never a score. */
export function psiStatusForError(err: unknown): Exclude<PsiStatus, "measured" | "no_key"> {
  return isPageSpeedTimeout(err) ? "timeout" : "error";
}

/** Strategies still without fresh scores in this audit (empty when scores are present). */
export function strategiesToMeasure(audit: PageSpeedCarrier | null | undefined): PageSpeedStrategy[] {
  if (!audit || audit.pageSpeed) return [];
  return PSI_STRATEGIES.filter((s) => !audit.pageSpeedPartial?.[s]);
}

export type AutoStartInput = {
  hasProjectUrl: boolean;
  audit: (PageSpeedCarrier & { pageSpeedUnavailable?: string }) | null | undefined;
  /** The audit's created_at (or auditedAt): one automatic measurement per project and audit. */
  auditStamp: string | null | undefined;
  alreadyStarted: boolean;
  running: boolean;
  /** The route already said no key is configured for this audit. */
  noKey: boolean;
};

/** Start only for a stored audit where PageSpeed was tried and gave nothing (timeout or error), once per audit. */
export function shouldAutoStart(input: AutoStartInput): boolean {
  const { audit } = input;
  if (!input.hasProjectUrl || !audit || !input.auditStamp) return false;
  if (input.alreadyStarted || input.running || input.noKey) return false;
  if (audit.pageSpeed) return false;
  if (audit.pageSpeedUnavailable !== "timeout" && audit.pageSpeedUnavailable !== "error") return false;
  return strategiesToMeasure(audit).length > 0;
}

/** One state for several strategy answers: measured only when every call measured; no_key wins; then timeout; else error. */
export function combineStatuses(statuses: PsiStatus[]): PsiStatus {
  if (statuses.length === 0) return "error";
  if (statuses.every((s) => s === "measured")) return "measured";
  if (statuses.includes("no_key")) return "no_key";
  if (statuses.includes("timeout")) return "timeout";
  return "error";
}

export function guardKey(projectId: string, auditStamp: string): string {
  return `marlo:psi-auto:${projectId}:${auditStamp}`;
}

type GuardStorage = Pick<Storage, "getItem" | "setItem">;

/** Per-tab guard in sessionStorage with an in-memory fallback when storage is blocked. */
export function createStartGuard(storage: () => GuardStorage | null, memory: Set<string> = new Set()) {
  return {
    has(key: string): boolean {
      if (memory.has(key)) return true;
      try {
        return storage()?.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    mark(key: string): void {
      memory.add(key);
      try {
        storage()?.setItem(key, "1");
      } catch {
        // blocked storage: the in-memory entry still holds for this page load
      }
    },
  };
}
