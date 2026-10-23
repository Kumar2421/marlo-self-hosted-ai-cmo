import type { Action, ActionStatus, ActionType } from "../../actions/actionTypes.ts";
import type { Finding } from "../../findings/findingTypes.ts";
import type { SearchSnapshotPayload } from "../../search/searchSnapshot.ts";
import { auditFromRow, geoFromRow, LEAD_SCAN_LIMIT, summarizeLeads, type LeadRow } from "../../chat/chatQueries.ts";
import { isFindingId, requireLocalScope } from "./scope.ts";
import type { DataGateway } from "./types.ts";

/** The slice of better-sqlite3 used here. The database handle is INJECTED (adapters own the DB import). */
export type SqliteLike = {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
};

type Row = Record<string, unknown>;
const MAX_ACTIONS = 200;
const MAX_FINDINGS = 500;

function parse<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

const inProject = (rows: unknown[], projectId: string): Row[] =>
  (rows as Row[]).filter((r) => r && r.project_id === projectId);

function mapFinding(r: Row): Finding {
  return {
    id: String(r.id), projectId: String(r.project_id), source: String(r.source), category: String(r.category),
    severity: r.severity as Finding["severity"], entityType: String(r.entity_type), entityId: String(r.entity_id),
    url: (r.url as string | null) ?? null, evidence: parse<Record<string, unknown>>(r.evidence, {}),
    recommendation: String(r.recommendation ?? ""), status: r.status as Finding["status"],
    firstSeen: String(r.first_seen), lastSeen: String(r.last_seen), resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
  };
}

function mapAction(r: Row): Action {
  return {
    id: String(r.id), projectId: String(r.project_id), findingId: String(r.finding_id),
    recommendationId: r.recommendation_id ? String(r.recommendation_id) : undefined,
    type: r.type as ActionType, status: r.status as ActionStatus, title: String(r.title),
    target: parse<Action["target"]>(r.target, {}), parameters: {},
    result: r.result ? parse<Record<string, unknown> | null>(r.result, null) : null,
    createdAt: String(r.created_at), startedAt: r.started_at ? String(r.started_at) : null,
    completedAt: r.completed_at ? String(r.completed_at) : null,
  };
}

/** Self-host gateway: parameterised SQLite queries, every one scoped to the project. */
export function createSqliteGateway(db: SqliteLike): DataGateway {
  return {
    async getSearchSnapshot(scope) {
      const { projectId } = requireLocalScope(scope);
      const rows = db.prepare("SELECT project_id, snapshot_date, payload FROM search_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT 1").all(projectId);
      const row = inProject(rows, projectId)[0];
      const payload = row ? parse<SearchSnapshotPayload | null>(row.payload, null) : null;
      return row && payload ? { snapshotDate: String(row.snapshot_date), payload } : null;
    },
    async listFindings(scope) {
      const { projectId } = requireLocalScope(scope);
      const rows = db.prepare(
        `SELECT * FROM findings WHERE project_id = ? ORDER BY
           CASE WHEN status = 'verified' THEN 1 ELSE 0 END,
           CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
           last_seen DESC LIMIT ?`,
      ).all(projectId, MAX_FINDINGS);
      return inProject(rows, projectId).map(mapFinding);
    },
    async getFinding(scope, id) {
      const { projectId } = requireLocalScope(scope);
      if (!isFindingId(id)) return null;
      const rows = db.prepare("SELECT * FROM findings WHERE project_id = ? AND id = ? LIMIT 1").all(projectId, id);
      const row = inProject(rows, projectId).find((r) => r.id === id);
      return row ? mapFinding(row) : null;
    },
    async listActions(scope, findingId) {
      const { projectId } = requireLocalScope(scope);
      let rows: unknown[];
      if (findingId !== undefined) {
        if (!isFindingId(findingId)) return [];
        rows = db.prepare("SELECT * FROM actions WHERE project_id = ? AND finding_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, findingId, MAX_ACTIONS);
      } else {
        rows = db.prepare("SELECT * FROM actions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, MAX_ACTIONS);
      }
      return inProject(rows, projectId).map(mapAction);
    },
    async getLeadSummary(scope, recentLimit) {
      const { projectId } = requireLocalScope(scope);
      const rows = db.prepare(
        `SELECT project_id, name, title, company, location, lead_type, email, email_verified, emailed_at, last_reply_at, created_at
         FROM leads WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      ).all(projectId, LEAD_SCAN_LIMIT);
      return summarizeLeads(inProject(rows, projectId) as unknown as LeadRow[], recentLimit);
    },
    async getGeoStatus(scope) {
      const { projectId } = requireLocalScope(scope);
      const rows = db.prepare("SELECT project_id, payload, checked_at FROM geo_checks WHERE project_id = ? LIMIT 1").all(projectId);
      const row = inProject(rows, projectId)[0];
      return geoFromRow(row ? { payload: row.payload, checked_at: String(row.checked_at) } : null);
    },
    async getAuditSummary(scope) {
      const { projectId } = requireLocalScope(scope);
      const proj = (db.prepare("SELECT id, url FROM projects WHERE id = ? LIMIT 1").all(projectId) as Row[]).find((r) => r.id === projectId);
      if (!proj?.url || typeof proj.url !== "string") return null;
      const row = (db.prepare("SELECT url, payload, created_at FROM seo_audits WHERE url = ? LIMIT 1").all(proj.url) as Row[])[0];
      return auditFromRow(row ? { payload: row.payload, created_at: String(row.created_at), url: String(row.url) } : null);
    },
    async listCompetitors(scope) {
      const { projectId } = requireLocalScope(scope);
      const rows = db.prepare("SELECT project_id, url FROM project_competitors WHERE project_id = ? ORDER BY created_at ASC LIMIT 50").all(projectId);
      return inProject(rows, projectId).map((r) => String(r.url));
    },
  };
}
