import type { SupabaseClient } from "@supabase/supabase-js";
import { SOCIAL_DAILY_SETTINGS_DOC, optedInProjectIds, parseDailyDraftSettings, type DailyDraftSettings } from "./dailyDraftSettings.ts";

// Platform (Supabase) store; every query is scoped by user and project explicitly.

export async function getDailyDraftSettings(db: SupabaseClient, userId: string, projectId: string): Promise<DailyDraftSettings> {
  const { data, error } = await db
    .from("project_documents")
    .select("content")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", SOCIAL_DAILY_SETTINGS_DOC)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseDailyDraftSettings(data?.content as string | undefined);
}

export async function saveDailyDraftSettings(db: SupabaseClient, userId: string, projectId: string, settings: DailyDraftSettings, now = new Date()): Promise<void> {
  const stamp = now.toISOString();
  const { data: existing, error: readError } = await db
    .from("project_documents")
    .select("created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", SOCIAL_DAILY_SETTINGS_DOC)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const { error } = await db.from("project_documents").upsert(
    {
      user_id: userId,
      project_id: projectId,
      doc_type: SOCIAL_DAILY_SETTINGS_DOC,
      status: "ready",
      content: JSON.stringify(settings),
      created_at: existing?.created_at ?? stamp,
      updated_at: stamp,
    },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
}

/** Project ids that switched at least one network on (the only projects the daily job drafts for). */
export async function optedInSocialProjects(db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db.from("project_documents").select("project_id, content").eq("doc_type", SOCIAL_DAILY_SETTINGS_DOC);
  if (error) throw new Error(error.message);
  return optedInProjectIds((data ?? []) as Array<{ project_id: string; content: string | null }>);
}
