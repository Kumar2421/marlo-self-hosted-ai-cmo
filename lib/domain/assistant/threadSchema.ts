/** SQLite twin of supabase/migrations/20261023000200_chat_threads.sql (self-host). Shared by lib/db.ts and tests. */
export const CHAT_THREADS_SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS chat_threads (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    project_id TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_threads_scope_idx ON chat_threads(user_id, project_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id         TEXT PRIMARY KEY,
    thread_id  TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content    TEXT NOT NULL CHECK (length(content) <= 8000),
    tools_used TEXT NOT NULL DEFAULT '[]',
    looked_at  TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages(thread_id, created_at);
`;
