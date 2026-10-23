import crypto from "node:crypto";
import type Database from "better-sqlite3";

/**
 * Server-side chat history port. Every method is scoped to {userId, projectId}: a thread can only be read or
 * changed by its owner, inside the project it was created in. Another user's (or project's) id simply finds nothing.
 * Implementations: memory (tests), SQLite (self-host), Supabase (threadStoreSupabase.ts).
 * Message content is never logged.
 */

/** Self-host has no auth; its single owner is stored under this id. */
export const LOCAL_OWNER = "local";
export const THREAD_RETENTION_DAYS = 90;
export const THREAD_LIST_LIMIT = 50;
export const THREAD_MESSAGES_LIMIT = 200;
export const THREAD_CONTENT_MAX = 8000;
export const THREAD_TITLE_MAX = 60;
export const THREAD_PREVIEW_MAX = 80;
/** How many stored messages are replayed to the model as history. */
export const THREAD_HISTORY_MESSAGES = 20;

export type ThreadScope = { userId: string | null; projectId: string };

export type ThreadSummary = { id: string; title: string; createdAt: string; updatedAt: string; preview: string };
export type ThreadMessage = {
  id: string; role: "user" | "assistant"; content: string; toolsUsed: string[]; lookedAt: string[]; createdAt: string;
};
export type NewThreadMessage = { role: "user" | "assistant"; content: string; toolsUsed?: string[]; lookedAt?: string[] };

/** The chat_threads tables do not exist yet (migration not applied). Chat keeps working with client-only history. */
export class ThreadsUnavailableError extends Error {
  constructor() {
    super("Chat history is not set up");
    this.name = "ThreadsUnavailableError";
  }
}

export interface ThreadStore {
  /** Cheap probe: false when the tables are missing. */
  isAvailable(): Promise<boolean>;
  createThread(scope: ThreadScope, title: string): Promise<ThreadSummary>;
  /** Newest activity first, last-message preview, at most THREAD_LIST_LIMIT. */
  listThreads(scope: ThreadScope): Promise<ThreadSummary[]>;
  /** The thread and its newest THREAD_MESSAGES_LIMIT messages (oldest first); null when not found / not yours. */
  getThread(scope: ThreadScope, id: string): Promise<{ thread: ThreadSummary; messages: ThreadMessage[] } | null>;
  /** The newest `limit` messages, oldest first; null when not found / not yours. */
  recentMessages(scope: ThreadScope, id: string, limit: number): Promise<ThreadMessage[] | null>;
  /** False when the thread is not found / not yours. Bumps updated_at. */
  appendMessages(scope: ThreadScope, id: string, messages: NewThreadMessage[]): Promise<boolean>;
  renameThread(scope: ThreadScope, id: string, title: string): Promise<boolean>;
  deleteThread(scope: ThreadScope, id: string): Promise<boolean>;
  /** Returns how many threads were deleted. */
  deleteAllThreads(scope: ThreadScope): Promise<number>;
  /** Retention: deletes threads whose updated_at is strictly older than `days` days. Not scoped (cron). */
  purgeOlderThan(days: number, now?: Date): Promise<number>;
}

const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]+`, "g"); // whitespace-class characters (incl. line breaks) are collapsed in the next step

/** Single line, no control characters, at most 60 characters. Falls back to "New chat". */
export function deriveThreadTitle(text: unknown): string {
  if (typeof text !== "string") return "New chat";
  const line = text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!line) return "New chat";
  return Array.from(line).slice(0, THREAD_TITLE_MAX).join("").trim();
}

export function previewOf(content: string): string {
  return Array.from(content.replace(/\s+/g, " ").trim()).slice(0, THREAD_PREVIEW_MAX).join("");
}

export function clampContent(content: string): string {
  return content.length > THREAD_CONTENT_MAX ? content.slice(0, THREAD_CONTENT_MAX) : content;
}

export function ownerOf(scope: ThreadScope): string {
  return scope.userId ?? LOCAL_OWNER;
}

export function cutoffIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

// ---------------------------------------------------------------- memory

type MemThread = { id: string; owner: string; projectId: string; title: string; createdAt: string; updatedAt: string };
type MemMessage = ThreadMessage & { threadId: string };

export function memoryThreadStore(opts: { now?: () => Date } = {}): ThreadStore & { setUnavailable(v: boolean): void } {
  const now = opts.now ?? (() => new Date());
  const threads = new Map<string, MemThread>();
  let messages: MemMessage[] = [];
  let unavailable = false;
  const guard = () => { if (unavailable) throw new ThreadsUnavailableError(); };
  const mine = (scope: ThreadScope, id: string): MemThread | null => {
    const t = threads.get(id);
    return t && t.owner === ownerOf(scope) && t.projectId === scope.projectId ? t : null;
  };
  const msgsOf = (id: string) => messages.filter((m) => m.threadId === id);
  const summary = (t: MemThread): ThreadSummary => {
    const last = msgsOf(t.id).at(-1);
    return { id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt, preview: last ? previewOf(last.content) : "" };
  };
  const strip = (m: MemMessage): ThreadMessage => ({ id: m.id, role: m.role, content: m.content, toolsUsed: m.toolsUsed, lookedAt: m.lookedAt, createdAt: m.createdAt });
  const dropThreads = (ids: string[]) => {
    for (const id of ids) threads.delete(id);
    messages = messages.filter((m) => !ids.includes(m.threadId));
  };

  return {
    setUnavailable(v) { unavailable = v; },
    async isAvailable() { return !unavailable; },
    async createThread(scope, title) {
      guard();
      const at = now().toISOString();
      const t: MemThread = {
        id: crypto.randomUUID(), owner: ownerOf(scope), projectId: scope.projectId,
        title: deriveThreadTitle(title), createdAt: at, updatedAt: at,
      };
      threads.set(t.id, t);
      return summary(t);
    },
    async listThreads(scope) {
      guard();
      return [...threads.values()]
        .filter((t) => t.owner === ownerOf(scope) && t.projectId === scope.projectId)
        .reverse() // insertion order is the tie-break: newest insert first (sort is stable)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
        .slice(0, THREAD_LIST_LIMIT)
        .map(summary);
    },
    async getThread(scope, id) {
      guard();
      const t = mine(scope, id);
      if (!t) return null;
      return { thread: summary(t), messages: msgsOf(id).slice(-THREAD_MESSAGES_LIMIT).map(strip) };
    },
    async recentMessages(scope, id, limit) {
      guard();
      return mine(scope, id) ? msgsOf(id).slice(-limit).map(strip) : null;
    },
    async appendMessages(scope, id, batch) {
      guard();
      const t = mine(scope, id);
      if (!t) return false;
      const at = now().toISOString();
      for (const m of batch) {
        messages.push({
          id: crypto.randomUUID(), threadId: id, role: m.role, content: clampContent(m.content),
          toolsUsed: m.toolsUsed ?? [], lookedAt: m.lookedAt ?? [], createdAt: at,
        });
      }
      t.updatedAt = at;
      return true;
    },
    async renameThread(scope, id, title) {
      guard();
      const t = mine(scope, id);
      if (!t) return false;
      t.title = deriveThreadTitle(title);
      return true;
    },
    async deleteThread(scope, id) {
      guard();
      if (!mine(scope, id)) return false;
      dropThreads([id]);
      return true;
    },
    async deleteAllThreads(scope) {
      guard();
      const ids = [...threads.values()]
        .filter((t) => t.owner === ownerOf(scope) && t.projectId === scope.projectId)
        .map((t) => t.id);
      dropThreads(ids);
      return ids.length;
    },
    async purgeOlderThan(days, at = now()) {
      guard();
      const cutoff = cutoffIso(days, at);
      const ids = [...threads.values()].filter((t) => t.updatedAt < cutoff).map((t) => t.id);
      dropThreads(ids);
      return ids.length;
    },
  };
}

// ---------------------------------------------------------------- sqlite (self-host)

type ThreadRow = { id: string; title: string; created_at: string; updated_at: string; preview?: string | null };
type MessageRow = { id: string; role: "user" | "assistant"; content: string; tools_used: string; looked_at: string; created_at: string };

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toMessage(r: MessageRow): ThreadMessage {
  return { id: r.id, role: r.role, content: r.content, toolsUsed: parseList(r.tools_used), lookedAt: parseList(r.looked_at), createdAt: r.created_at };
}

function toSummary(r: ThreadRow): ThreadSummary {
  return { id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, preview: previewOf(r.preview ?? "") };
}

const SUMMARY_SQL = `SELECT t.id, t.title, t.created_at, t.updated_at,
    (SELECT m.content FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS preview
  FROM chat_threads t`;
const RECENT_SQL = `SELECT * FROM (
    SELECT rowid AS rid, * FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
  ) ORDER BY created_at ASC, rid ASC`;

/** SQLite store. `getDb` is lazy so importing this never opens the database. */
export function sqliteThreadStore(getDb: () => Database.Database, opts: { now?: () => Date } = {}): ThreadStore {
  const now = opts.now ?? (() => new Date());
  /** Maps "no such table" to the unavailable signal. */
  function run<T>(fn: (db: Database.Database) => T): T {
    try {
      return fn(getDb());
    } catch (err) {
      if (err instanceof Error && /no such table/i.test(err.message)) throw new ThreadsUnavailableError();
      throw err;
    }
  }
  const ownedRow = (db: Database.Database, scope: ThreadScope, id: string) =>
    db.prepare(`${SUMMARY_SQL} WHERE t.id = ? AND t.user_id = ? AND t.project_id = ?`)
      .get(id, ownerOf(scope), scope.projectId) as ThreadRow | undefined;
  const removeThreads = (db: Database.Database, ids: string[]) => {
    const delMsgs = db.prepare("DELETE FROM chat_messages WHERE thread_id = ?");
    const delThread = db.prepare("DELETE FROM chat_threads WHERE id = ?");
    db.transaction(() => {
      for (const id of ids) {
        delMsgs.run(id);
        delThread.run(id);
      }
    })();
  };

  return {
    async isAvailable() {
      try {
        run((db) => db.prepare("SELECT 1 FROM chat_threads LIMIT 1").get());
        return true;
      } catch (err) {
        if (err instanceof ThreadsUnavailableError) return false;
        throw err;
      }
    },
    async createThread(scope, title) {
      return run((db) => {
        const at = now().toISOString();
        const id = crypto.randomUUID();
        const t = deriveThreadTitle(title);
        db.prepare("INSERT INTO chat_threads (id, user_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(id, ownerOf(scope), scope.projectId, t, at, at);
        return { id, title: t, createdAt: at, updatedAt: at, preview: "" };
      });
    },
    async listThreads(scope) {
      return run((db) =>
        (db.prepare(`${SUMMARY_SQL} WHERE t.user_id = ? AND t.project_id = ? ORDER BY t.updated_at DESC, t.rowid DESC LIMIT ?`)
          .all(ownerOf(scope), scope.projectId, THREAD_LIST_LIMIT) as ThreadRow[]).map(toSummary));
    },
    async getThread(scope, id) {
      return run((db) => {
        const row = ownedRow(db, scope, id);
        if (!row) return null;
        const msgs = db.prepare(RECENT_SQL).all(id, THREAD_MESSAGES_LIMIT) as MessageRow[];
        return { thread: toSummary(row), messages: msgs.map(toMessage) };
      });
    },
    async recentMessages(scope, id, limit) {
      return run((db) => {
        if (!ownedRow(db, scope, id)) return null;
        return (db.prepare(RECENT_SQL).all(id, limit) as MessageRow[]).map(toMessage);
      });
    },
    async appendMessages(scope, id, batch) {
      return run((db) => {
        if (!ownedRow(db, scope, id)) return false;
        const at = now().toISOString();
        const ins = db.prepare(
          "INSERT INTO chat_messages (id, thread_id, user_id, role, content, tools_used, looked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        );
        db.transaction(() => {
          for (const m of batch) {
            ins.run(
              crypto.randomUUID(), id, ownerOf(scope), m.role, clampContent(m.content),
              JSON.stringify(m.toolsUsed ?? []), JSON.stringify(m.lookedAt ?? []), at,
            );
          }
          db.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(at, id);
        })();
        return true;
      });
    },
    async renameThread(scope, id, title) {
      return run((db) =>
        db.prepare("UPDATE chat_threads SET title = ? WHERE id = ? AND user_id = ? AND project_id = ?")
          .run(deriveThreadTitle(title), id, ownerOf(scope), scope.projectId).changes > 0);
    },
    async deleteThread(scope, id) {
      return run((db) => {
        if (!ownedRow(db, scope, id)) return false;
        removeThreads(db, [id]);
        return true;
      });
    },
    async deleteAllThreads(scope) {
      return run((db) => {
        const ids = (db.prepare("SELECT id FROM chat_threads WHERE user_id = ? AND project_id = ?")
          .all(ownerOf(scope), scope.projectId) as { id: string }[]).map((r) => r.id);
        removeThreads(db, ids);
        return ids.length;
      });
    },
    async purgeOlderThan(days, at = now()) {
      return run((db) => {
        const ids = (db.prepare("SELECT id FROM chat_threads WHERE updated_at < ?").all(cutoffIso(days, at)) as { id: string }[]).map((r) => r.id);
        removeThreads(db, ids);
        return ids.length;
      });
    },
  };
}
