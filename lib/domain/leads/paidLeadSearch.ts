/**
 * Order of operations for a hosted (platform-key) lead search:
 *   1. daily lead limit        (nothing spent yet)
 *   2. credit pre-check        (nothing spent yet; skipped when billing is off)
 *   3. search                  (Tavily/Google + optional LLM company fill-in)
 *   4. charge credits          (only when the search returned at least one lead)
 * Credits are never taken for a search that found nothing or failed, and a
 * refused charge means the leads are not returned or saved.
 */

export type PaidLeadSearchOutcome<T> =
  | { ok: true; leads: T[]; charged: boolean }
  | { ok: false; status: 402 | 403 | 502; error: string };

export type PaidLeadSearchPorts<T> = {
  checkDailyLimit: () => Promise<{ allowed: boolean; message?: string }>;
  /** Omit when there is nothing to pre-check. Resolves false when the user cannot pay. */
  hasCredits?: () => Promise<boolean>;
  search: () => Promise<T[]>;
  /** Resolves false when the user ran out of credits at charge time. */
  charge: () => Promise<boolean>;
};

export const OUT_OF_CREDITS_MESSAGE = "Out of credits. Upgrade or connect your own key.";
export const DAILY_LIMIT_FALLBACK_MESSAGE = "Daily lead limit reached";

export async function runPaidLeadSearch<T>(ports: PaidLeadSearchPorts<T>): Promise<PaidLeadSearchOutcome<T>> {
  const limit = await ports.checkDailyLimit();
  if (!limit.allowed) {
    return { ok: false, status: 403, error: limit.message || DAILY_LIMIT_FALLBACK_MESSAGE };
  }

  if (ports.hasCredits && !(await ports.hasCredits())) {
    return { ok: false, status: 402, error: OUT_OF_CREDITS_MESSAGE };
  }

  let leads: T[];
  try {
    leads = await ports.search();
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : String(err) };
  }

  if (leads.length === 0) return { ok: true, leads, charged: false };

  const paid = await ports.charge();
  if (!paid) return { ok: false, status: 402, error: OUT_OF_CREDITS_MESSAGE };
  return { ok: true, leads, charged: true };
}
