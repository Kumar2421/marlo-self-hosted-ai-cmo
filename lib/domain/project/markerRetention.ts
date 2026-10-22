import type { SupabaseClient } from "@supabase/supabase-js";
import { PROPOSAL_CLAIM_PREFIX, PROPOSAL_DONE_PREFIX } from "../actions/automationSettings.ts";
import { ATTEMPT_PREFIX, CLAIM_PREFIX, DONE_PREFIX } from "../social/dailyDraftsStoreSupabase.ts";
import { AUTO_VERIFY_MARKER_PREFIX } from "../findings/autoVerifyJob.ts";
import { MONITOR_MARKER } from "../findings/monitorTargets.ts";

/**
 * Cron idempotency markers stored as project_documents rows, one new row per
 * project and day. Only these grow without bound, so only these are pruned.
 */
export const DATED_MARKER_PREFIXES: readonly string[] = [PROPOSAL_CLAIM_PREFIX, PROPOSAL_DONE_PREFIX, CLAIM_PREFIX, ATTEMPT_PREFIX, DONE_PREFIX];

/**
 * Every doc_type a cron writes as a marker. auto_verify:<findingId> (one per
 * finding, carries attempt counts) and monitor_audit (one row per project, its
 * updated_at is the last-run time) are bounded and stateful, so they are
 * excluded from pruning but still never real documents.
 */
export const ALL_MARKER_PREFIXES: readonly string[] = [...DATED_MARKER_PREFIXES, AUTO_VERIFY_MARKER_PREFIX];
export const ALL_MARKER_EXACT: readonly string[] = [MONITOR_MARKER];

export const MARKER_RETENTION_DAYS = 30;
const BATCH = 500;

export function isPrunableMarker(docType: string): boolean {
  return DATED_MARKER_PREFIXES.some((p) => docType.startsWith(p));
}

export type PruneResult = { deleted: number; batches: number };

/**
 * Deletes dated marker rows created more than 30 days ago, in bounded batches
 * until the time budget is spent. Idempotent; a rerun just continues. Each
 * row is re-checked against the marker prefixes before deletion, so a real
 * document can never be removed.
 */
export async function pruneOldMarkers(
  db: SupabaseClient,
  now: Date,
  opts: { budgetMs: number; retentionDays?: number; maxBatches?: number },
): Promise<PruneResult> {
  const cutoff = new Date(now.getTime() - (opts.retentionDays ?? MARKER_RETENTION_DAYS) * 24 * 60 * 60 * 1000).toISOString();
  const started = Date.now();
  const orFilter = DATED_MARKER_PREFIXES.map((p) => `doc_type.like.${p}*`).join(",");
  let deleted = 0;
  let batches = 0;
  while (batches < (opts.maxBatches ?? 20) && Date.now() - started < opts.budgetMs) {
    const { data, error } = await db
      .from("project_documents")
      .select("project_id, doc_type")
      .or(orFilter)
      .lt("created_at", cutoff)
      .limit(BATCH);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as Array<{ project_id: unknown; doc_type: unknown }>).filter((r) => isPrunableMarker(String(r.doc_type)));
    if (rows.length === 0) break;
    const byProject = new Map<string, string[]>();
    for (const r of rows) {
      const list = byProject.get(String(r.project_id)) ?? [];
      list.push(String(r.doc_type));
      byProject.set(String(r.project_id), list);
    }
    for (const [projectId, types] of byProject) {
      const { error: delError } = await db.from("project_documents").delete().eq("project_id", projectId).in("doc_type", types).lt("created_at", cutoff);
      if (delError) throw new Error(delError.message);
      deleted += types.length;
    }
    batches++;
    if (rows.length < BATCH) break;
  }
  return { deleted, batches };
}
