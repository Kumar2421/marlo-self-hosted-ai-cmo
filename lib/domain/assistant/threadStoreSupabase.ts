import type { SupabaseClient } from "@supabase/supabase-js";
import {
  THREAD_LIST_LIMIT, THREAD_MESSAGES_LIMIT, ThreadsUnavailableError, clampContent, cutoffIso, deriveThreadTitle, previewOf,
  type ThreadMessage, type ThreadStore, type ThreadSummary,
} from "./threadStore.ts";

type PgError = { code?: string; message?: string } | null;
type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 42P01 = undefined_table (Postgres), PGRST205 = table not in PostgREST's schema cache. */
function check(error: PgError): void {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205" || /could not find the table|does not exist/i.test(error.message ?? "")) {
    throw new ThreadsUnavailableError();
  }
  throw new Error(error.message ?? "chat history store error");
}

function summary(r: Row, preview = ""): ThreadSummary {
  return {
    id: String(r.id), title: String(r.title ?? ""), createdAt: String(r.created_at), updatedAt: String(r.updated_at), preview: previewOf(preview),
  };
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function message(r: Row): ThreadMessage {
  return {
    id: String(r.id), role: r.role === "assistant" ? "assistant" : "user", content: String(r.content ?? ""),
    toolsUsed: list(r.tools_used), lookedAt: list(r.looked_at), createdAt: String(r.created_at),
  };
}

/**
 * Hosted store. Give it the USER's session client (RLS owner policies are then the access control); every query is
 * also filtered by user_id and project_id explicitly. The retention purge needs the service-role client instead.
 * `getClient` is lazy so nothing connects until a request needs it.
 */
export function supabaseThreadStore(getClient: () => SupabaseClient | Promise<SupabaseClient>): ThreadStore {
  const uid = (scope: { userId: string | null }) => {
    if (!scope.userId) throw new Error("chat history needs a signed-in user");
    return scope.userId;
  };

  async function ownedThread(db: SupabaseClient, scope: { userId: string | null; projectId: string }, id: string): Promise<Row | null> {
    if (!UUID.test(id)) return null;
    const { data, error } = await db.from("chat_threads").select("*")
      .eq("id", id).eq("user_id", uid(scope)).eq("project_id", scope.projectId).maybeSingle();
    check(error);
    return (data as Row | null) ?? null;
  }

  async function lastPreview(db: SupabaseClient, id: string): Promise<string> {
    const { data, error } = await db.from("chat_messages").select("content")
      .eq("thread_id", id).order("created_at", { ascending: false }).limit(1);
    check(error);
    return String(((data ?? [])[0] as Row | undefined)?.content ?? "");
  }

  async function recent(db: SupabaseClient, id: string, limit: number): Promise<ThreadMessage[]> {
    const { data, error } = await db.from("chat_messages").select("*")
      .eq("thread_id", id).order("created_at", { ascending: false }).limit(limit);
    check(error);
    return ((data ?? []) as Row[]).map(message).reverse();
  }

  return {
    async isAvailable() {
      try {
        const db = await getClient();
        const { error } = await db.from("chat_threads").select("id").limit(1);
        check(error);
        return true;
      } catch (err) {
        if (err instanceof ThreadsUnavailableError) return false;
        throw err;
      }
    },
    async createThread(scope, title) {
      const db = await getClient();
      const { data, error } = await db.from("chat_threads")
        .insert({ user_id: uid(scope), project_id: scope.projectId, title: deriveThreadTitle(title) })
        .select("*").single();
      check(error);
      return summary(data as Row);
    },
    async listThreads(scope) {
      const db = await getClient();
      const { data, error } = await db.from("chat_threads").select("*")
        .eq("user_id", uid(scope)).eq("project_id", scope.projectId)
        .order("updated_at", { ascending: false }).limit(THREAD_LIST_LIMIT);
      check(error);
      const rows = (data ?? []) as Row[];
      if (rows.length === 0) return [];
      // One query for all previews: newest messages first, the first seen per thread wins. Bounded, so a thread whose
      // newest message falls outside the window shows no preview rather than costing one query per thread.
      const { data: msgs, error: msgError } = await db.from("chat_messages").select("thread_id, content")
        .in("thread_id", rows.map((r) => String(r.id))).order("created_at", { ascending: false }).limit(rows.length * 6);
      check(msgError);
      const previews = new Map<string, string>();
      for (const m of (msgs ?? []) as Row[]) if (!previews.has(String(m.thread_id))) previews.set(String(m.thread_id), String(m.content ?? ""));
      return rows.map((r) => summary(r, previews.get(String(r.id)) ?? ""));
    },
    async getThread(scope, id) {
      const db = await getClient();
      const row = await ownedThread(db, scope, id);
      if (!row) return null;
      const messages = await recent(db, id, THREAD_MESSAGES_LIMIT);
      return { thread: summary(row, messages.at(-1)?.content ?? await lastPreview(db, id)), messages };
    },
    async recentMessages(scope, id, limit) {
      const db = await getClient();
      if (!(await ownedThread(db, scope, id))) return null;
      return recent(db, id, limit);
    },
    async appendMessages(scope, id, batch) {
      const db = await getClient();
      if (!(await ownedThread(db, scope, id))) return false;
      const base = Date.now();
      // Distinct, increasing timestamps keep the order of a batch stable.
      const rows = batch.map((m, i) => ({
        thread_id: id, user_id: uid(scope), role: m.role, content: clampContent(m.content),
        tools_used: m.toolsUsed ?? [], looked_at: m.lookedAt ?? [], created_at: new Date(base + i).toISOString(),
      }));
      const { error } = await db.from("chat_messages").insert(rows);
      check(error);
      const { error: upError } = await db.from("chat_threads")
        .update({ updated_at: new Date(base + batch.length).toISOString() }).eq("id", id).eq("user_id", uid(scope));
      check(upError);
      return true;
    },
    async renameThread(scope, id, title) {
      if (!UUID.test(id)) return false;
      const db = await getClient();
      const { data, error } = await db.from("chat_threads").update({ title: deriveThreadTitle(title) })
        .eq("id", id).eq("user_id", uid(scope)).eq("project_id", scope.projectId).select("id");
      check(error);
      return (data ?? []).length > 0;
    },
    async deleteThread(scope, id) {
      if (!UUID.test(id)) return false;
      const db = await getClient();
      const { data, error } = await db.from("chat_threads").delete()
        .eq("id", id).eq("user_id", uid(scope)).eq("project_id", scope.projectId).select("id");
      check(error);
      return (data ?? []).length > 0;
    },
    async deleteAllThreads(scope) {
      const db = await getClient();
      const { data, error } = await db.from("chat_threads").delete()
        .eq("user_id", uid(scope)).eq("project_id", scope.projectId).select("id");
      check(error);
      return (data ?? []).length;
    },
    async purgeOlderThan(days, now = new Date()) {
      const db = await getClient();
      const { data, error } = await db.from("chat_threads").delete().lt("updated_at", cutoffIso(days, now)).select("id");
      check(error);
      return (data ?? []).length;
    },
  };
}

