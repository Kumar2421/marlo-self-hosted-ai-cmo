import type { SupabaseClient } from "@supabase/supabase-js";
import type { Action, ActionStatus, ActionType } from "../../actions/actionTypes.ts";
import type { Finding } from "../../findings/findingTypes.ts";
import { compareFindingsByPriority } from "../../findings/findingPriority.ts";
import type { SearchSnapshotPayload } from "../../search/searchSnapshot.ts";
import { auditFromRow, geoFromRow, LEAD_SCAN_LIMIT, summarizeLeads, type LeadRow } from "../../chat/chatQueries.ts";
import { isFindingId, requireHostedScope, ScopeError, type GatewayScope } from "./scope.ts";
import type { DataGateway } from "./types.ts";

/**
 * Hosted gateway. `db` MUST be the signed-in user's own client (utils/supabase/server createClient),
 * so Postgres row level security enforces tenancy. Every query still carries explicit user_id and
 * project_id filters, and every returned row is checked again against the scope: if the backend ever
 * hands back a row that is not this user's and this project's, it is dropped.
 *
 * Tables read (all have an owner RLS policy, see README): projects, search_snapshots, findings,
 * actions (owner via projects), leads, geo_checks, seo_audits, project_competitors.
 */
const MAX_ACTIONS = 200;
const MAX_FINDINGS = 500;

type Row = Record<string, unknown>;

function mine(rows: unknown, userId: string, projectId: string): Row[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Row[]).filter((r) => r && r.user_id === userId && r.project_id === projectId);
}

function mapFinding(r: Row): Finding {
  return {
    id: String(r.id), projectId: String(r.project_id), source: String(r.source), category: String(r.category),
    severity: r.severity as Finding["severity"], entityType: String(r.entity_type), entityId: String(r.entity_id),
    url: (r.url as string | null) ?? null,
    evidence: (r.evidence && typeof r.evidence === "object" ? r.evidence : {}) as Record<string, unknown>,
    recommendation: String(r.recommendation ?? ""), status: r.status as Finding["status"],
    firstSeen: String(r.first_seen), lastSeen: String(r.last_seen), resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
  };
}

function mapAction(r: Row): Action {
  return {
    id: String(r.id), projectId: String(r.project_id), findingId: String(r.finding_id),
    recommendationId: r.recommendation_id ? String(r.recommendation_id) : undefined,
    type: r.type as ActionType, status: r.status as ActionStatus, title: String(r.title),
    target: (r.target ?? {}) as Action["target"], parameters: {},
    result: r.result && typeof r.result === "object" ? (r.result as Record<string, unknown>) : null,
    createdAt: String(r.created_at), startedAt: r.started_at ? String(r.started_at) : null,
    completedAt: r.completed_at ? String(r.completed_at) : null,
  };
}

export function createSupabaseGateway(db: SupabaseClient): DataGateway {
  /** The project must be owned by the user; checked once per (user, project) per gateway instance. */
  const owned = new Map<string, Promise<boolean>>();
  const assertOwned = async (userId: string, projectId: string): Promise<void> => {
    const key = `${userId}:${projectId}`;
    let p = owned.get(key);
    if (!p) {
      p = (async () => {
        const { data, error } = await db.from("projects").select("id, owner_id").eq("id", projectId).eq("owner_id", userId).limit(1);
        if (error) throw new Error(`Could not verify project: ${error.message}`);
        return Array.isArray(data) && data.some((r) => (r as Row).id === projectId && (r as Row).owner_id === userId);
      })();
      owned.set(key, p);
    }
    if (!(await p)) throw new ScopeError("Project not found.");
  };

  const begin = async (scope: GatewayScope) => {
    const s = requireHostedScope(scope);
    await assertOwned(s.userId, s.projectId);
    return s;
  };

  return {
    async getSearchSnapshot(scope) {
      const { userId, projectId } = await begin(scope);
      const { data, error } = await db
        .from("search_snapshots").select("user_id, project_id, snapshot_date, payload")
        .eq("project_id", projectId).eq("user_id", userId)
        .order("snapshot_date", { ascending: false }).limit(1);
      if (error) throw new Error(`Could not load search snapshot: ${error.message}`);
      const row = mine(data, userId, projectId)[0];
      return row ? { snapshotDate: String(row.snapshot_date), payload: row.payload as SearchSnapshotPayload } : null;
    },

    async listFindings(scope) {
      const { userId, projectId } = await begin(scope);
      const { data, error } = await db
        .from("findings").select("*").eq("user_id", userId).eq("project_id", projectId)
        .order("last_seen", { ascending: false }).limit(MAX_FINDINGS);
      if (error) throw new Error(`Could not load findings: ${error.message}`);
      const rows = mine(data, userId, projectId);
      rows.sort((a, b) => compareFindingsByPriority(a as never, b as never));
      return rows.map(mapFinding);
    },

    async getFinding(scope, id) {
      const { userId, projectId } = await begin(scope);
      if (!isFindingId(id)) return null;
      const { data, error } = await db
        .from("findings").select("*").eq("user_id", userId).eq("project_id", projectId).eq("id", id).limit(1);
      if (error) throw new Error(`Could not load finding: ${error.message}`);
      const row = mine(data, userId, projectId).find((r) => r.id === id);
      return row ? mapFinding(row) : null;
    },

    async listActions(scope, findingId) {
      const { projectId } = await begin(scope);
      let q = db.from("actions")
        .select("id, project_id, finding_id, recommendation_id, type, status, title, target, result, created_at, started_at, completed_at")
        .eq("project_id", projectId);
      if (findingId !== undefined) {
        if (!isFindingId(findingId)) return [];
        q = q.eq("finding_id", findingId);
      }
      const { data, error } = await q.order("created_at", { ascending: false }).limit(MAX_ACTIONS);
      if (error) throw new Error(`Could not load actions: ${error.message}`);
      // actions has no user_id column: ownership comes from the project check above plus this row check.
      return (Array.isArray(data) ? (data as Row[]) : [])
        .filter((r) => r && r.project_id === projectId && (findingId === undefined || r.finding_id === findingId))
        .map(mapAction);
    },

    async getLeadSummary(scope, recentLimit) {
      const { userId, projectId } = await begin(scope);
      const { data, error } = await db
        .from("leads")
        .select("user_id, project_id, name, title, company, location, lead_type, email, email_verified, emailed_at, last_reply_at, created_at")
        .eq("user_id", userId).eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(LEAD_SCAN_LIMIT);
      if (error) throw new Error(`Could not load leads: ${error.message}`);
      return summarizeLeads(mine(data, userId, projectId) as unknown as LeadRow[], recentLimit);
    },

    async getGeoStatus(scope) {
      const { userId, projectId } = await begin(scope);
      const { data, error } = await db
        .from("geo_checks").select("user_id, project_id, payload, checked_at")
        .eq("user_id", userId).eq("project_id", projectId).limit(1);
      if (error) throw new Error(`Could not load GEO check: ${error.message}`);
      const row = mine(data, userId, projectId)[0];
      return geoFromRow(row ? { payload: row.payload, checked_at: String(row.checked_at) } : null);
    },

    async getAuditSummary(scope) {
      const { userId, projectId } = await begin(scope);
      const { data, error } = await db
        .from("seo_audits").select("user_id, project_id, url, payload, created_at")
        .eq("user_id", userId).eq("project_id", projectId)
        .order("created_at", { ascending: false }).limit(1);
      if (error) throw new Error(`Could not load SEO audit: ${error.message}`);
      const row = mine(data, userId, projectId)[0];
      return auditFromRow(row ? { payload: row.payload, created_at: String(row.created_at), url: String(row.url) } : null);
    },

    async listCompetitors(scope) {
      const { userId, projectId } = await begin(scope);
      const { data, error } = await db
        .from("project_competitors").select("user_id, project_id, url, created_at")
        .eq("user_id", userId).eq("project_id", projectId)
        .order("created_at", { ascending: true }).limit(50);
      if (error) throw new Error(`Could not load competitors: ${error.message}`);
      return mine(data, userId, projectId).map((r) => String(r.url));
    },
  };
}
