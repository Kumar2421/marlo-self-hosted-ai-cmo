import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformId } from "./platforms.ts";
import { SOCIAL_PLATFORMS, isoDay } from "./dailyDrafts.ts";

// Platform (Supabase) store for the daily drafts job. Markers reuse project_documents
// (unique per project and doc_type), the same pattern as the daily proposals job.
// Every query is scoped to the project explicitly.

export const CLAIM_PREFIX = "social_daily_claim:";
export const ATTEMPT_PREFIX = "social_daily_attempt:";
export const DONE_PREFIX = "social_daily_done:";
const CLAIM_STALE_MS = 10 * 60 * 1000;
/** Markers older than this do not affect rotation order. */
const MARKER_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
/** PostgREST returns at most 1000 rows per request, so reads page through the rest. */
const PAGE_SIZE = 1000;

const PENDING_TABLE: Record<PlatformId, string> = { x: "x_drafts", linkedin: "linkedin_drafts", reddit: "reddit_post_drafts" };

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** Every row of a query, read PAGE_SIZE at a time with .range(from, to). Throws on the first error. */
export async function fetchAllRows<T>(load: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await load(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** The claim row content: the owner's random token, so only that run can release it. */
function claimContent(token: string): string {
  return JSON.stringify({ token });
}

/**
 * Atomically claim the (project, UTC day) run. Returns the owner token when
 * this run holds the claim, or null when another run holds a fresh one.
 */
export async function claimSocialDay(db: SupabaseClient, userId: string, projectId: string, day: string, now = new Date()): Promise<string | null> {
  const stamp = now.toISOString();
  const docType = CLAIM_PREFIX + day;
  const token = randomUUID();
  const { error } = await db.from("project_documents").insert({
    user_id: userId, project_id: projectId, doc_type: docType, status: "ready", content: claimContent(token), created_at: stamp, updated_at: stamp,
  });
  if (!error) return token;
  if (error.code !== "23505") throw new Error(error.message);
  // Someone holds it: take over only if it is stale, as one conditional update.
  const cutoff = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  const { data } = await db
    .from("project_documents")
    .update({ updated_at: stamp, content: claimContent(token) })
    .eq("project_id", projectId)
    .eq("doc_type", docType)
    .lt("updated_at", cutoff)
    .select("project_id");
  return (data ?? []).length > 0 ? token : null;
}

/**
 * Release the claim, but only the row this run wrote (its token matches). A run
 * that lost its claim to a takeover cannot free the new owner's claim.
 */
export async function releaseSocialDay(db: SupabaseClient, userId: string, projectId: string, day: string, token: string): Promise<void> {
  await db
    .from("project_documents")
    .delete()
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", CLAIM_PREFIX + day)
    .eq("content", claimContent(token));
}

/** Whether this network was already attempted today. Every attempt writes its marker before any work. */
export async function isSocialPlatformAttempted(db: SupabaseClient, projectId: string, day: string, platform: PlatformId): Promise<boolean> {
  const { data, error } = await db
    .from("project_documents")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("doc_type", ATTEMPT_PREFIX + day + ":" + platform)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function markSocialPlatformAttempted(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  day: string,
  platform: PlatformId,
  now = new Date(),
): Promise<void> {
  const stamp = now.toISOString();
  const { error } = await db.from("project_documents").upsert(
    { user_id: userId, project_id: projectId, doc_type: ATTEMPT_PREFIX + day + ":" + platform, status: "ready", content: "{}", created_at: stamp, updated_at: stamp },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
}

/** Records a saved draft and how many drafts it made (content is a JSON object with a created count), for the global daily ceiling. */
export async function markSocialPlatformDone(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  day: string,
  platform: PlatformId,
  created: number,
  now = new Date(),
): Promise<void> {
  const stamp = now.toISOString();
  const { error } = await db.from("project_documents").upsert(
    {
      user_id: userId, project_id: projectId, doc_type: DONE_PREFIX + day + ":" + platform, status: "ready",
      content: JSON.stringify({ created }), created_at: stamp, updated_at: stamp,
    },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
}

export type MarkerRow = { project_id: string; doc_type: string; updated_at: string; content: string | null };

export type MarkerSummary = {
  /** Networks attempted today, per project. */
  attemptedToday: Map<string, Set<PlatformId>>;
  /** ISO time of each project's most recent attempt (any day in the window), for rotation. */
  lastAttempt: Map<string, string>;
  /** Job drafts saved today across all projects (the global ceiling). */
  createdToday: number;
};

function createdCount(content: string | null): number {
  try {
    const n = (JSON.parse(content ?? "{}") as { created?: unknown }).created;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Pure: turns marker rows into today's attempts, rotation times and the created total. Other rows are ignored. */
export function summarizeMarkers(rows: MarkerRow[], now: Date): MarkerSummary {
  const day = isoDay(now);
  const attemptedToday = new Map<string, Set<PlatformId>>();
  const lastAttempt = new Map<string, string>();
  let createdToday = 0;
  for (const row of rows) {
    // doc_type is "<kind>:<yyyy-mm-dd>:<platform>".
    const [kind, markerDay, platform] = String(row.doc_type).split(":");
    if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) continue;
    const projectId = String(row.project_id);
    if (kind === "social_daily_attempt") {
      const at = String(row.updated_at);
      if (!lastAttempt.has(projectId) || at > (lastAttempt.get(projectId) ?? "")) lastAttempt.set(projectId, at);
      if (markerDay === day) {
        const set = attemptedToday.get(projectId) ?? new Set<PlatformId>();
        set.add(platform as PlatformId);
        attemptedToday.set(projectId, set);
      }
    } else if (kind === "social_daily_done" && markerDay === day) {
      createdToday += createdCount(row.content);
    }
  }
  return { attemptedToday, lastAttempt, createdToday };
}

/** Today's attempts per project, each project's last attempt time, and today's created total. */
export async function loadSocialMarkers(db: SupabaseClient, now = new Date()): Promise<MarkerSummary> {
  const since = new Date(now.getTime() - MARKER_WINDOW_MS).toISOString();
  const rows = await fetchAllRows<MarkerRow>((from, to) =>
    db
      .from("project_documents")
      .select("project_id, doc_type, updated_at, content")
      .like("doc_type", "social_daily_%")
      .gte("updated_at", since)
      .order("project_id")
      .order("doc_type")
      .range(from, to),
  );
  return summarizeMarkers(rows, now);
}

/** Every project with a non-empty Product Information document (the only projects the job drafts for). */
export async function socialProductInfoProjects(db: SupabaseClient): Promise<Array<{ projectId: string; userId: string }>> {
  const rows = await fetchAllRows<{ project_id: string; user_id: string }>((from, to) =>
    db
      .from("project_documents")
      .select("project_id, user_id")
      .eq("doc_type", "product_info")
      .not("content", "is", null)
      .neq("content", "")
      .order("project_id")
      .range(from, to),
  );
  return rows.map((row) => ({ projectId: String(row.project_id), userId: String(row.user_id) }));
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
