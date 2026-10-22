import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "../jobs/paginate.ts";
import { AUTOMATION_DOC, PROPOSAL_CLAIM_PREFIX, PROPOSAL_CLAIM_STALE_MS, PROPOSAL_DONE_PREFIX, DEFAULT_AUTOMATION, normalizeAutomation, type AutomationSettings } from "./automationSettings.ts";

// Platform (Supabase) store; every query is scoped by user and project explicitly.

export async function getAutomationSettings(db: SupabaseClient, userId: string, projectId: string): Promise<AutomationSettings> {
  const { data } = await db
    .from("project_documents")
    .select("content")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", AUTOMATION_DOC)
    .maybeSingle();
  if (!data?.content) return { ...DEFAULT_AUTOMATION };
  try {
    return normalizeAutomation(JSON.parse(data.content as string));
  } catch {
    return { ...DEFAULT_AUTOMATION };
  }
}

/** Atomically claim the daily proposal run for a UTC day (unique project_id + doc_type). False if another run holds a fresh claim. */
export async function claimProposalRun(db: SupabaseClient, userId: string, projectId: string, day: string, now = new Date()): Promise<boolean> {
  const stamp = now.toISOString();
  const docType = PROPOSAL_CLAIM_PREFIX + day;
  const { error } = await db.from("project_documents").insert({
    user_id: userId, project_id: projectId, doc_type: docType, status: "ready", content: "{}", created_at: stamp, updated_at: stamp,
  });
  if (!error) return true;
  if (error.code !== "23505") throw new Error(error.message);
  // Someone holds it: take over only if it is stale, as a single conditional update.
  const cutoff = new Date(now.getTime() - PROPOSAL_CLAIM_STALE_MS).toISOString();
  const { data } = await db
    .from("project_documents")
    .update({ updated_at: stamp })
    .eq("project_id", projectId)
    .eq("doc_type", docType)
    .lt("updated_at", cutoff)
    .select("project_id");
  return (data ?? []).length > 0;
}

export async function releaseProposalRun(db: SupabaseClient, userId: string, projectId: string, day: string): Promise<void> {
  await db.from("project_documents").delete().eq("user_id", userId).eq("project_id", projectId).eq("doc_type", PROPOSAL_CLAIM_PREFIX + day);
}

/** Project ids whose daily proposal step already finished on this UTC day. Paged (PostgREST caps a response at 1000 rows); throws on a failed read. */
export async function listProposalsDone(db: SupabaseClient, day: string): Promise<Set<string>> {
  const rows = await fetchAllPages<{ project_id: unknown }>(
    (from, to) =>
      db
        .from("project_documents")
        .select("project_id")
        .eq("doc_type", PROPOSAL_DONE_PREFIX + day)
        .order("project_id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: { project_id: unknown }[] | null; error: { message: string } | null }>,
  );
  return new Set(rows.map((row) => String(row.project_id)));
}

export async function markProposalsDone(db: SupabaseClient, userId: string, projectId: string, day: string, now = new Date()): Promise<void> {
  const stamp = now.toISOString();
  const { error } = await db.from("project_documents").upsert(
    { user_id: userId, project_id: projectId, doc_type: PROPOSAL_DONE_PREFIX + day, status: "ready", content: "{}", created_at: stamp, updated_at: stamp },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
}

export async function saveAutomationSettings(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  settings: AutomationSettings,
  now = new Date(),
): Promise<AutomationSettings> {
  const stamp = now.toISOString();
  const saved: AutomationSettings = { mode: settings.mode, updatedAt: stamp };
  const { data: existing } = await db
    .from("project_documents")
    .select("created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", AUTOMATION_DOC)
    .maybeSingle();
  const { error } = await db.from("project_documents").upsert(
    {
      user_id: userId,
      project_id: projectId,
      doc_type: AUTOMATION_DOC,
      status: "ready",
      content: JSON.stringify(saved),
      created_at: existing?.created_at ?? stamp,
      updated_at: stamp,
    },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
  return saved;
}
