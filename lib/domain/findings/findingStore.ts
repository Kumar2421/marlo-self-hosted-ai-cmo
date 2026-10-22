import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { canTransitionFinding, invalidTransitionError, staleFindingError } from "./findingTypes";
import type { Finding, FindingSeverity } from "./findingTypes";

type FindingRow = {
  id: string; project_id: string; source: string; category: string; severity: FindingSeverity;
  entity_type: string; entity_id: string; url: string | null; evidence: string;
  recommendation: string; status: Finding["status"]; first_seen: string; last_seen: string; resolved_at: string | null;
};

function mapFinding(row: FindingRow): Finding {
  return {
    id: row.id, projectId: row.project_id, source: row.source, category: row.category,
    severity: row.severity, entityType: row.entity_type, entityId: row.entity_id, url: row.url,
    evidence: JSON.parse(row.evidence || "{}") as Record<string, unknown>,
    recommendation: row.recommendation, status: row.status, firstSeen: row.first_seen,
    lastSeen: row.last_seen, resolvedAt: row.resolved_at,
  };
}

export function getProjectFinding(projectId: string, id: string): Finding | null {
  const row = getDb().prepare("SELECT * FROM findings WHERE project_id = ? AND id = ? LIMIT 1").get(projectId, id) as FindingRow | undefined;
  return row ? mapFinding(row) : null;
}

/** Conditional on the status that was read (a stale write throws a conflict); a status change leaves last_seen alone. */
export function updateFindingStatus(projectId: string, id: string, status: Finding["status"], from?: Finding["status"]): Finding | null {
  const db = getDb();
  const existing = getProjectFinding(projectId, id);
  if (!existing) return null;
  if (from && existing.status !== from) throw staleFindingError();
  if (!canTransitionFinding(existing.status, status)) {
    throw invalidTransitionError(existing.status, status);
  }
  const now = new Date().toISOString();
  const changed = db.prepare("UPDATE findings SET status = ?, resolved_at = ? WHERE project_id = ? AND id = ? AND status = ?")
    .run(status, status === "verified" ? now : null, projectId, id, existing.status).changes;
  if (changed === 0) throw staleFindingError();
  return getProjectFinding(projectId, id);
}

export function refreshFinding(projectId: string, id: string, input: {
  severity: FindingSeverity;
  evidence: Record<string, unknown>;
  recommendation: string;
  status: Finding["status"];
  expectedStatus?: Finding["status"];
}): Finding | null {
  const db = getDb();
  if (!getProjectFinding(projectId, id)) return null;
  const now = new Date().toISOString();
  const guard = input.expectedStatus ? " AND status = ?" : "";
  const args: unknown[] = [input.severity, JSON.stringify(input.evidence), input.recommendation, input.status, input.status === "verified" ? now : null, now, projectId, id];
  if (input.expectedStatus) args.push(input.expectedStatus);
  const changed = db.prepare(`UPDATE findings SET severity = ?, evidence = ?, recommendation = ?, status = ?, resolved_at = ?, last_seen = ? WHERE project_id = ? AND id = ?${guard}`)
    .run(...(args as never[])).changes;
  if (changed === 0) throw staleFindingError();
  return getProjectFinding(projectId, id);
}

export function listProjectFindings(projectId: string): Finding[] {
  // Resolved findings sort last regardless of severity — otherwise an old,
  // already-fixed critical finding (still carrying severity: "critical")
  // outranks a live, unresolved warning, directly undermining "what should
  // I fix first." "failed" (recheck ran, issue confirmed still present)
  // stays ranked by severity like any other active finding.
  const rows = getDb().prepare(
    `SELECT * FROM findings WHERE project_id = ? ORDER BY
       CASE WHEN status = 'verified' THEN 1 ELSE 0 END,
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       last_seen DESC`
  ).all(projectId) as FindingRow[];
  return rows.map(mapFinding);
}

export function upsertFinding(input: {
  projectId: string; source: string; category: string; severity: FindingSeverity;
  entityType: string; entityId: string; url?: string | null;
  evidence: Record<string, unknown>; recommendation: string;
}): Finding {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare(
    "SELECT * FROM findings WHERE project_id = ? AND source = ? AND category = ? AND entity_type = ? AND entity_id = ? AND url IS ? LIMIT 1"
  ).get(input.projectId, input.source, input.category, input.entityType, input.entityId, input.url ?? null) as FindingRow | undefined;

  const id = existing?.id ?? ("finding_" + crypto.randomUUID());
  // A verified finding reappearing in fresh analytics starts a new remediation cycle.
  const nextStatus = existing?.status === "verified" ? "fixing" : (existing?.status ?? "new");
  db.prepare(
    `INSERT INTO findings
      (id, project_id, source, category, severity, entity_type, entity_id, url, evidence, recommendation, status, first_seen, last_seen, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, source, category, entity_type, entity_id, url) DO UPDATE SET
       severity = excluded.severity, evidence = excluded.evidence,
       recommendation = excluded.recommendation, status = excluded.status, resolved_at = excluded.resolved_at, last_seen = excluded.last_seen`
  ).run(
    id, input.projectId, input.source, input.category, input.severity, input.entityType,
    input.entityId, input.url ?? null, JSON.stringify(input.evidence), input.recommendation,
    nextStatus, existing?.first_seen ?? now, now, null
  );

  return mapFinding(db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as FindingRow);
}
