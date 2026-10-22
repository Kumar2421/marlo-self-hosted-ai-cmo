import type Database from "better-sqlite3";
import { docKeyOfType, normalizeSetupState, type SetupFacts, type SetupState } from "./setupState.ts";
import type { SetupStateStore } from "./setupStateService.ts";

// Self-host (SQLite) store. Takes the database explicitly so it can be tested in memory.

type Row = { steps: string; started_at: string | null; finished_at: string | null; updated_at: string };

export function sqliteSetupStateStore(db: Database.Database, projectId: string): SetupStateStore {
  return {
    async load() {
      const row = db.prepare("SELECT steps, started_at, finished_at, updated_at FROM project_setup_state WHERE project_id = ?").get(projectId) as Row | undefined;
      if (!row) return null;
      let steps: unknown = null;
      try {
        steps = JSON.parse(row.steps);
      } catch {
        /* corrupt row: normalize to all pending */
      }
      return normalizeSetupState(
        { steps, startedAt: row.started_at, finishedAt: row.finished_at, updatedAt: row.updated_at },
        new Date(),
      );
    },

    async saveIfUnchanged(state: SetupState, expectedUpdatedAt: string | null) {
      const params = {
        id: projectId,
        steps: JSON.stringify(state.steps),
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        updatedAt: state.updatedAt,
      };
      if (expectedUpdatedAt === null) {
        return db
          .prepare(
            `INSERT OR IGNORE INTO project_setup_state (project_id, steps, started_at, finished_at, updated_at)
             VALUES (@id, @steps, @startedAt, @finishedAt, @updatedAt)`,
          )
          .run(params).changes === 1;
      }
      return (
        db
          .prepare(
            `UPDATE project_setup_state SET steps = @steps, started_at = @startedAt, finished_at = @finishedAt, updated_at = @updatedAt
             WHERE project_id = @id AND updated_at = @expected`,
          )
          .run({ ...params, expected: expectedUpdatedAt }).changes === 1
      );
    },

    async facts(): Promise<SetupFacts> {
      const project = db.prepare("SELECT url, description FROM projects WHERE id = ?").get(projectId) as { url: string; description: string } | undefined;
      const audit = project ? (db.prepare("SELECT 1 AS n FROM seo_audits WHERE url = ?").get(project.url) as unknown) : undefined;
      const comps = db.prepare("SELECT COUNT(*) AS n FROM project_competitors WHERE project_id = ?").get(projectId) as { n: number };
      const docs = db
        .prepare("SELECT doc_type FROM project_documents WHERE project_id = ? AND TRIM(content) <> ''")
        .all(projectId) as { doc_type: string }[];
      return {
        hasAudit: Boolean(audit),
        hasDescription: Boolean(project?.description?.trim()),
        hasCompetitors: comps.n > 0,
        documents: docs.map((d) => docKeyOfType(d.doc_type)).filter((k): k is NonNullable<typeof k> => k !== null),
      };
    },
  };
}
