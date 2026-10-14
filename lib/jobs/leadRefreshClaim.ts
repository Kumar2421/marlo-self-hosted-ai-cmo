import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Claim-before-generate for the lead stamp (projects.leads_auto_last_at).
 *
 * The stamp is written before the slow LLM/search work so two overlapping runs
 * cannot both generate for one project. If the work then throws, the stamp is
 * put back to the value it had before the claim, so a failed run does not lock
 * the project out for 24 hours. The restore is compare-and-set: it only applies
 * while the stamp still equals our claim, so it never clobbers a newer stamp.
 */

/** Storage port for the stamp. The Supabase one is below; tests use a fake. */
export type LeadStampStore = {
  /** Stamp `nowIso` only while the project is still due. True only for the run that won. */
  claim(projectId: string, cutoffIso: string, nowIso: string): Promise<boolean>;
  /** Put `previousIso` back, but only while the stamp still equals `claimedIso`. True if it was restored. */
  restore(projectId: string, claimedIso: string, previousIso: string | null): Promise<boolean>;
};

export type LeadRefreshClaimOptions = {
  projectId: string;
  cutoffIso: string;
  nowIso: string;
  /** The stamp as read before the claim (null when the project was never refreshed). */
  previousIso: string | null;
  /** Optional wall-clock budget for the work. When it runs out the work is abandoned and the stamp restored. */
  timeoutMs?: number;
};

export type LeadRefreshClaimResult<T> = { status: "refused" } | { status: "done"; value: T };

/**
 * Runs `work` under the claim. Refused (no work run) when another run holds a
 * fresh stamp. A throw from `work`, or the budget running out, restores the
 * previous stamp and rethrows. A claim that fails to write throws before any
 * restore is needed.
 */
export async function runClaimedLeadRefresh<T>(
  store: LeadStampStore,
  opts: LeadRefreshClaimOptions,
  work: () => Promise<T>,
): Promise<LeadRefreshClaimResult<T>> {
  const claimed = await store.claim(opts.projectId, opts.cutoffIso, opts.nowIso);
  if (!claimed) return { status: "refused" };

  try {
    const value = await withBudget(work(), opts.timeoutMs);
    return { status: "done", value };
  } catch (err) {
    await store.restore(opts.projectId, opts.nowIso, opts.previousIso).catch(() => false);
    throw err;
  }
}

function withBudget<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Lead refresh ran out of time.")), Math.max(1, timeoutMs));
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/**
 * Compare-and-set claim for the daily lead refresh. The stamp is written only
 * while the project is still due (never refreshed, or last refreshed before
 * cutoffIso), so two overlapping cron invocations cannot both generate leads
 * for the same project. Returns true only for the run that won the claim.
 */
export async function claimDueLeadRefresh(db: SupabaseClient, projectId: string, cutoffIso: string, nowIso: string): Promise<boolean> {
  const { data, error } = await db
    .from("projects")
    .update({ leads_auto_last_at: nowIso })
    .eq("id", projectId)
    .or(`leads_auto_last_at.is.null,leads_auto_last_at.lt.${cutoffIso}`)
    .select("id");
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

/** The real store: conditional UPDATEs on the projects row. */
export function supabaseLeadStampStore(db: SupabaseClient): LeadStampStore {
  return {
    claim: (projectId, cutoffIso, nowIso) => claimDueLeadRefresh(db, projectId, cutoffIso, nowIso),
    async restore(projectId, claimedIso, previousIso) {
      const { data, error } = await db
        .from("projects")
        .update({ leads_auto_last_at: previousIso })
        .eq("id", projectId)
        .eq("leads_auto_last_at", claimedIso)
        .select("id");
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length > 0;
    },
  };
}
