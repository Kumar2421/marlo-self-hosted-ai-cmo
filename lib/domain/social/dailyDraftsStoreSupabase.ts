import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformId } from "./platforms.ts";
import { SOCIAL_PLATFORMS, isoDay } from "./dailyDrafts.ts";

// Platform (Supabase) store for the daily drafts job. Markers reuse project_documents
// (unique per project and doc_type), the same pattern as the daily proposals job.
// Every query is scoped to the project explicitly.

const CLAIM_PREFIX = "social_daily_claim:";
const DONE_PREFIX = "social_daily_done:";
const CLAIM_STALE_MS = 10 * 60 * 1000;
/** Markers older than this do not affect rotation order. */
const MARKER_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const PENDING_TABLE: Record<PlatformId, string> = { x: "x_drafts", linkedin: "linkedin_drafts", reddit: "reddit_post_drafts" };

/** Atomically claim the (project, UTC day) run. False when another run holds a fresh claim. */
export async function claimSocialDay(db: SupabaseClient, userId: string, projectId: string, day: string, now = new Date()): Promise<boolean> {
  const stamp = now.toISOString();
  const docType = CLAIM_PREFIX + day;
  const { error } = await db.from("project_documents").insert({
    user_id: userId, project_id: projectId, doc_type: docType, status: "ready", content: "{}", created_at: stamp, updated_at: stamp,
  });
  if (!error) return true;
  if (error.code !== "23505") throw new Error(error.message);
  // Someone holds it: take over only if it is stale, as one conditional update.
  const cutoff = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  const { data } = await db
    .from("project_documents")
    .update({ updated_at: stamp })
    .eq("project_id", projectId)
    .eq("doc_type", docType)
    .lt("updated_at", cutoff)
    .select("project_id");
  return (data ?? []).length > 0;
}

export async function releaseSocialDay(db: SupabaseClient, userId: string, projectId: string, day: string): Promise<void> {
  await db.from("project_documents").delete().eq("user_id", userId).eq("project_id", projectId).eq("doc_type", CLAIM_PREFIX + day);
}

export async function isSocialPlatformDone(db: SupabaseClient, projectId: string, day: string, platform: PlatformId): Promise<boolean> {
  const { data, error } = await db
    .from("project_documents")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("doc_type", DONE_PREFIX + day + ":" + platform)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function markSocialPlatformDone(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  day: string,
  platform: PlatformId,
  now = new Date(),
): Promise<void> {
  const stamp = now.toISOString();
  const { error } = await db.from("project_documents").upsert(
    { user_id: userId, project_id: projectId, doc_type: DONE_PREFIX + day + ":" + platform, status: "ready", content: "{}", created_at: stamp, updated_at: stamp },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Today's finished networks per project, and each project's most recent marker
 * time (for rotation). One query covers the recent window.
 */
export async function loadSocialMarkers(
  db: SupabaseClient,
  now = new Date(),
): Promise<{ doneToday: Map<string, Set<PlatformId>>; lastDone: Map<string, string> }> {
  const since = new Date(now.getTime() - MARKER_WINDOW_MS).toISOString();
  const { data, error } = await db
    .from("project_documents")
    .select("project_id, doc_type, updated_at")
    .like("doc_type", `${DONE_PREFIX}%`)
    .gte("updated_at", since);
  if (error) throw new Error(error.message);

  const day = isoDay(now);
  const doneToday = new Map<string, Set<PlatformId>>();
  const lastDone = new Map<string, string>();
  for (const row of data ?? []) {
    // doc_type is "social_daily_done:<yyyy-mm-dd>:<platform>".
    const [, markerDay, platform] = String(row.doc_type).split(":");
    if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) continue;
    const projectId = String(row.project_id);
    const at = String(row.updated_at);
    if (!lastDone.has(projectId) || at > (lastDone.get(projectId) ?? "")) lastDone.set(projectId, at);
    if (markerDay === day) {
      const set = doneToday.get(projectId) ?? new Set<PlatformId>();
      set.add(platform as PlatformId);
      doneToday.set(projectId, set);
    }
  }
  return { doneToday, lastDone };
}

/** Every project with a non-empty Product Information document (the only projects the job drafts for). */
export async function socialProductInfoProjects(db: SupabaseClient): Promise<Array<{ projectId: string; userId: string }>> {
  const { data, error } = await db
    .from("project_documents")
    .select("project_id, user_id")
    .eq("doc_type", "product_info")
    .not("content", "is", null)
    .neq("content", "");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ projectId: String(row.project_id), userId: String(row.user_id) }));
}

/** Unreviewed (status draft) drafts waiting on one network for this project. */
export async function pendingDraftCount(db: SupabaseClient, userId: string, projectId: string, platform: PlatformId): Promise<number> {
  const { count, error } = await db
    .from(PENDING_TABLE[platform])
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  return count ?? 0;
}
