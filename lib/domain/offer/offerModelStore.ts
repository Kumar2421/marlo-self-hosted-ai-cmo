import type Database from "better-sqlite3";
import { normalizeOfferModel, type OfferModel } from "./offerModel.ts";

/** Stored as an `offer_model` row in project_documents (JSON content), like the lead profile, so no schema change is needed in either mode. */
export const OFFER_MODEL_DOC = "offer_model";

// Self-host (SQLite) store. Takes the database explicitly so it can be tested in memory.

export function getOfferModel(db: Database.Database, projectId: string): OfferModel | null {
  const row = db
    .prepare("SELECT content FROM project_documents WHERE project_id = ? AND doc_type = ?")
    .get(projectId, OFFER_MODEL_DOC) as { content: string } | undefined;
  if (!row?.content) return null;
  try {
    return normalizeOfferModel(JSON.parse(row.content));
  } catch {
    return null;
  }
}

export function saveOfferModel(db: Database.Database, projectId: string, offer: OfferModel, now = new Date()): void {
  const stamp = now.toISOString();
  db.prepare(
    `INSERT INTO project_documents (project_id, doc_type, status, content, created_at, updated_at)
     VALUES (?, ?, 'ready', ?, ?, ?)
     ON CONFLICT(project_id, doc_type) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
  ).run(projectId, OFFER_MODEL_DOC, JSON.stringify(offer), stamp, stamp);
}
