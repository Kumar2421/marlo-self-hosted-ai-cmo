/**
 * Order of operations for a hosted (platform-key) lead search:
 *   1. daily lead limit        (nothing spent yet)
 *   2. credit pre-check        (nothing spent yet; skipped when billing is off)
 *   3. search                  (Tavily/Google + optional LLM company fill-in)
 *   4. save the leads          (nothing is charged when the save fails)
 *   5. charge credits          (only after at least one lead is saved)
 * Credits are never taken for a search that found nothing, failed, or could
 * not be saved. If the charge is refused after the save, the saved leads are
 * kept and returned with charged=false; they are not deleted.
 */

export type PaidLeadSearchOutcome<R> =
  | { ok: true; leads: R[]; charged: boolean }
  | { ok: false; status: 402 | 403 | 500 | 502; error: string };

export type SaveResult<R> = { ok: true; rows: R[] } | { ok: false; status: 500 | 502; error: string };

export type PaidLeadSearchPorts<T, R> = {
  checkDailyLimit: () => Promise<{ allowed: boolean; message?: string }>;
  /** Omit when there is nothing to pre-check. Resolves false when the user cannot pay. */
  hasCredits?: () => Promise<boolean>;
  search: () => Promise<T[]>;
  /** Persists the leads and returns the saved rows, or a failure (which is never charged). */
  save: (leads: T[]) => Promise<SaveResult<R>>;
  /** Runs only after a successful save. Resolves false when the user ran out of credits at charge time. */
  charge: () => Promise<boolean>;
};

export const OUT_OF_CREDITS_MESSAGE = "Out of credits. Upgrade or connect your own key.";
export const DAILY_LIMIT_FALLBACK_MESSAGE = "Daily lead limit reached";

export async function runPaidLeadSearch<T, R>(ports: PaidLeadSearchPorts<T, R>): Promise<PaidLeadSearchOutcome<R>> {
  const limit = await ports.checkDailyLimit();
  if (!limit.allowed) {
    return { ok: false, status: 403, error: limit.message || DAILY_LIMIT_FALLBACK_MESSAGE };
  }

  if (ports.hasCredits && !(await ports.hasCredits())) {
    return { ok: false, status: 402, error: OUT_OF_CREDITS_MESSAGE };
  }

  let found: T[];
  try {
    found = await ports.search();
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : String(err) };
  }

  if (found.length === 0) return { ok: true, leads: [], charged: false };

  let saved: SaveResult<R>;
  try {
    saved = await ports.save(found);
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : String(err) };
  }
  if (!saved.ok) return { ok: false, status: saved.status, error: saved.error };
  // Only a successful insert of at least one lead is billable.
  if (saved.rows.length === 0) return { ok: true, leads: [], charged: false };

  const charged = await ports.charge();
  return { ok: true, leads: saved.rows, charged };
}
