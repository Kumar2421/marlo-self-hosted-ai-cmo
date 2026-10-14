import type Database from "better-sqlite3";
import { SOCIAL_DAILY_SETTINGS_DOC, parseDailyDraftSettings, type DailyDraftSettings } from "./dailyDraftSettings.ts";

// Self-host (SQLite) store. Takes the database explicitly so it can be tested in memory.

export function getDailyDraftSettings(db: Database.Database, projectId: string): DailyDraftSettings {
  const row = db
    .prepare("SELECT content FROM project_documents WHERE project_id = ? AND doc_type = ?")
    .get(projectId, SOCIAL_DAILY_SETTINGS_DOC) as { content: string } | undefined;
  return parseDailyDraftSettings(row?.content);
}

export function saveDailyDraftSettings(db: Database.Database, projectId: string, settings: DailyDraftSettings, now = new Date()): void {
  const stamp = now.toISOString();
  db.prepare(
    `INSERT INTO project_documents (project_id, doc_type, status, content, created_at, updated_at)
     VALUES (?, ?, 'ready', ?, ?, ?)
     ON CONFLICT(project_id, doc_type) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
  ).run(projectId, SOCIAL_DAILY_SETTINGS_DOC, JSON.stringify(settings), stamp, stamp);
}
