import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { listProjectActions } from "@/lib/domain/actions/actionStore";
import { listProjectActions as listProjectActionsSupabase } from "@/lib/domain/actions/actionStoreSupabase";
import { getProjectFinding, listProjectFindings } from "@/lib/domain/findings/findingStore";
import { getProjectFinding as getProjectFindingSupabase, listProjectFindings as listProjectFindingsSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import { getFindingRecommendations } from "@/lib/domain/recommendations/recommendationService";
import { readOutcomes, type OutcomePorts } from "@/lib/domain/search/outcomeService";
import { getLatestSnapshot } from "@/lib/domain/search/searchSnapshotStore";
import { getLatestSnapshot as getLatestSnapshotSupabase } from "@/lib/domain/search/searchSnapshotStoreSupabase";
import { auditFromRow, geoFromRow, summarizeLeads, supabaseAuditSummary, supabaseCompetitors, supabaseGeoStatus, supabaseLeadSummary, LEAD_SCAN_LIMIT, type LeadRow } from "./chatQueries";
import type { ChatPorts } from "./tools";

type Snapshot = Awaited<ReturnType<ChatPorts["getSearchSnapshot"]>>;

/**
 * Outcome reading with every write disabled: readOutcomes() normally saves
 * verdicts and fetches live page fingerprints. Chat is read-only, so writes
 * are no-ops and no network fetch happens; saved fingerprints/outcomes are
 * still honoured.
 */
function readOnlyOutcomePorts(getSnapshot: () => Promise<Snapshot>, getFinding: OutcomePorts["getFinding"]): OutcomePorts {
  const forbidden = async (): Promise<never> => { throw new Error("read-only"); };
  return {
    projectUrl: null,
    getAction: async () => null,
    getFinding,
    getSnapshot,
    completeAction: forbidden,
    saveResult: async () => undefined,
    resetAction: forbidden,
    moveFinding: forbidden,
    fetchFingerprint: async () => null,
  };
}

/** Platform (Supabase) ports: service client, every query scoped to this user and project. */
export function platformChatPorts(db: SupabaseClient, userId: string, projectId: string): ChatPorts {
  const getSearchSnapshot = async () => {
    const s = await getLatestSnapshotSupabase(db, userId, projectId);
    return s ? { snapshotDate: s.snapshotDate, payload: s.payload } : null;
  };
  const getFinding = (id: string) => getProjectFindingSupabase(db, userId, projectId, id);
  const outcomePorts = readOnlyOutcomePorts(getSearchSnapshot, getFinding);
  return {
    getSearchSnapshot,
    listFindings: () => listProjectFindingsSupabase(db, userId, projectId),
    getFinding,
    recommendationsFor: getFindingRecommendations,
    listActionsWithOutcomes: async (findingId) =>
      readOutcomes(outcomePorts, await listProjectActionsSupabase(db, userId, projectId, findingId)),
    getLeadSummary: (n) => supabaseLeadSummary(db, userId, projectId, n),
    getGeoStatus: () => supabaseGeoStatus(db, userId, projectId),
    getAuditSummary: () => supabaseAuditSummary(db, userId, projectId),
    listCompetitors: () => supabaseCompetitors(db, userId, projectId),
    now: () => new Date(),
  };
}

/** Self-host (SQLite) ports for the single local project. */
export function selfHostChatPorts(projectId: string): ChatPorts {
  const getSearchSnapshot = async () => {
    const s = getLatestSnapshot(getDb(), projectId);
    return s ? { snapshotDate: s.snapshotDate, payload: s.payload } : null;
  };
  const getFinding = async (id: string) => getProjectFinding(projectId, id);
  const outcomePorts = readOnlyOutcomePorts(getSearchSnapshot, getFinding);
  return {
    getSearchSnapshot,
    listFindings: async () => listProjectFindings(projectId),
    getFinding,
    recommendationsFor: getFindingRecommendations,
    listActionsWithOutcomes: async (findingId) => readOutcomes(outcomePorts, listProjectActions(projectId, findingId)),
    getLeadSummary: async (n) => {
      const rows = getDb()
        .prepare(
          `SELECT name, title, company, location, lead_type, email, email_verified, emailed_at, last_reply_at, created_at
           FROM leads WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(projectId, LEAD_SCAN_LIMIT) as LeadRow[];
      return summarizeLeads(rows, n);
    },
    getGeoStatus: async () => {
      const row = getDb().prepare("SELECT payload, checked_at FROM geo_checks WHERE project_id = ?").get(projectId) as
        | { payload: string; checked_at: string }
        | undefined;
      return geoFromRow(row ?? null);
    },
    getAuditSummary: async () => {
      const proj = getDb().prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as { url: string | null } | undefined;
      if (!proj?.url) return null;
      const row = getDb().prepare("SELECT url, payload, created_at FROM seo_audits WHERE url = ?").get(proj.url) as
        | { url: string; payload: string; created_at: string }
        | undefined;
      return auditFromRow(row ?? null);
    },
    listCompetitors: async () =>
      (getDb().prepare("SELECT url FROM project_competitors WHERE project_id = ? ORDER BY created_at ASC LIMIT 50").all(projectId) as { url: string }[]).map((r) => r.url),
    now: () => new Date(),
  };
}
