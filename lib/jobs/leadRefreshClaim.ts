import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Compare-and-set claim for the daily lead refresh. The stamp is written only
 * while the project is still due (never refreshed, or last refreshed before
 * `cutoffIso`), so two overlapping cron invocations cannot both generate leads
 * for the same project. Returns true only for the run that won the claim.
 */
export async function claimDueLeadRefresh(
  db: SupabaseClient,
  projectId: string,
  cutoffIso: string,
  nowIso: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("projects")
    .update({ leads_auto_last_at: nowIso })
    .eq("id", projectId)
    .or(`leads_auto_last_at.is.null,leads_auto_last_at.lt.${cutoffIso}`)
    .select("id");
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}
