import type { SupabaseClient } from "@supabase/supabase-js";
import { canTransitionFinding } from "./findingTypes";
import type { Finding, FindingSeverity } from "./findingTypes";
import { compareFindingsByPriority } from "./findingPriority";

/** Supabase mirror of findingStore.ts (self-host, SQLite) — same function
 * names/shapes, same table layout, just Postgres + an explicit userId for
 * RLS-equivalent scoping via the service-role client. */

export type FindingRow = {
  id: string;
  project_id: string;
  source: string;
  category: string;
  severity: FindingSeverity;
  entity_type: string;
  entity_id: string;
  url: string | null;
  evidence: Record<string, unknown>;
  recommendation: string;
  status: Finding["status"];
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
};

export function mapFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    projectId: row.project_id,
    source: row.source,
    category: row.category,
    severity: row.severity,
    entityType: row.entity_type,
    entityId: row.entity_id,
    url: row.url,
    evidence: row.evidence ?? {},
    recommendation: row.recommendation,
    status: row.status,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    resolvedAt: row.resolved_at,
  };
}

export async function listProjectFindings(db: SupabaseClient, userId: string, projectId: string): Promise<Finding[]> {
  const { data } = await db
    .from("findings")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("last_seen", { ascending: false });

  const rows = (data ?? []) as FindingRow[];
  rows.sort(compareFindingsByPriority);
  return rows.map(mapFinding);
}

export async function upsertFinding(
  db: SupabaseClient,
  userId: string,
  input: {
    projectId: string;
    source: string;
    category: string;
    severity: FindingSeverity;
    entityType: string;
    entityId: string;
    url?: string | null;
    evidence: Record<string, unknown>;
    recommendation: string;
  }
): Promise<Finding> {
  const now = new Date().toISOString();
  let existingQuery = db
    .from("findings")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", input.projectId)
    .eq("source", input.source)
    .eq("category", input.category)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId);
  existingQuery = input.url ? existingQuery.eq("url", input.url) : existingQuery.is("url", null);
  const { data: existing } = await existingQuery.maybeSingle();

  const nextStatus = existing?.status === "verified" ? "fixing" : (existing?.status ?? "new");

  const { data, error } = await db
    .from("findings")
    .upsert(
      {
        id: existing?.id,
        user_id: userId,
        project_id: input.projectId,
        source: input.source,
        category: input.category,
        severity: input.severity,
        entity_type: input.entityType,
        entity_id: input.entityId,
        url: input.url ?? null,
        evidence: input.evidence,
        recommendation: input.recommendation,
        status: nextStatus,
        first_seen: existing?.first_seen ?? now,
        last_seen: now,
        resolved_at: nextStatus === "verified" ? existing?.resolved_at ?? now : null,
      },
      { onConflict: "project_id,source,category,entity_type,entity_id,url" }
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  return mapFinding(data as FindingRow);
}

export async function getProjectFinding(db: SupabaseClient, userId: string, projectId: string, id: string): Promise<Finding | null> {
  const { data } = await db.from("findings").select("*").eq("user_id", userId).eq("project_id", projectId).eq("id", id).maybeSingle();
  return data ? mapFinding(data as FindingRow) : null;
}

export async function updateFindingStatus(db: SupabaseClient, userId: string, projectId: string, id: string, status: Finding["status"]): Promise<Finding | null> {
  const existing = await getProjectFinding(db, userId, projectId, id);
  if (!existing) return null;
  if (!canTransitionFinding(existing.status, status)) {
    throw new Error(`Invalid finding status transition: ${existing.status} -> ${status}`);
  }
  const now = new Date().toISOString();
  const { data, error } = await db.from("findings").update({
    status,
    last_seen: now,
    resolved_at: status === "verified" ? now : null,
  }).eq("user_id", userId).eq("project_id", projectId).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return mapFinding(data as FindingRow);
}

export async function refreshFinding(db: SupabaseClient, userId: string, projectId: string, id: string, input: {
  severity: FindingSeverity;
  evidence: Record<string, unknown>;
  recommendation: string;
  status: Finding["status"];
}): Promise<Finding | null> {
  const now = new Date().toISOString();
  const { data, error } = await db.from("findings").update({
    severity: input.severity,
    evidence: input.evidence,
    recommendation: input.recommendation,
    status: input.status,
    last_seen: now,
    resolved_at: input.status === "verified" ? now : null,
  }).eq("user_id", userId).eq("project_id", projectId).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapFinding(data as FindingRow) : null;
}
