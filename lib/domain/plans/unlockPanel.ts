import type { PlanInfoPlan } from "./planInfo.ts";

/** A dismissed unlock panel stays away this long, then comes back once. */
export const UNLOCK_DISMISS_DAYS = 7;
/** localStorage key holding the time (ms since epoch) it was dismissed. */
export const UNLOCK_DISMISS_KEY = "marlo-unlock-dismissed-at";

const DAY_MS = 86_400_000;

/**
 * Whether the "Unlock the full AI CMO" panel above the chat should show.
 * - Only for the hosted app's free plan: self-host has no plans, and paid plans have nothing to unlock.
 * - Never while the plan is still unknown (loading or failed), so it cannot flash for paying users.
 * - Hidden for UNLOCK_DISMISS_DAYS after the user closes it.
 */
export function shouldShowUnlockPanel(args: { plan: PlanInfoPlan | undefined; dismissedAt: number | null; now: number }): boolean {
  if (args.plan !== "free") return false;
  if (args.dismissedAt !== null && Number.isFinite(args.dismissedAt) && args.now - args.dismissedAt < UNLOCK_DISMISS_DAYS * DAY_MS) return false;
  return true;
}

/** Parses the stored dismissal time; anything unreadable counts as "not dismissed". */
export function parseDismissedAt(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
