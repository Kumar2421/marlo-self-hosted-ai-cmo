import type { SupabaseClient } from "@supabase/supabase-js";
import type { FindingRepository } from "./findingService";
import {
  getProjectFinding,
  listProjectFindings,
  refreshFinding,
  updateFindingStatus,
} from "./findingStore";
import {
  getProjectFinding as getProjectFindingSupabase,
  listProjectFindings as listProjectFindingsSupabase,
  refreshFinding as refreshFindingSupabase,
  updateFindingStatus as updateFindingStatusSupabase,
} from "./findingStoreSupabase";

/** Self-host (SQLite) findings repository. */
export function sqliteFindingRepository(): FindingRepository {
  return {
    get: (projectId, id) => getProjectFinding(projectId, id),
    list: (projectId) => listProjectFindings(projectId),
    transition: (projectId, id, status, from) => updateFindingStatus(projectId, id, status, from),
    refresh: (projectId, id, input) => refreshFinding(projectId, id, input),
  };
}

/** Platform (Supabase) findings repository, scoped to one authenticated user. */
export function supabaseFindingRepository(db: SupabaseClient, userId: string): FindingRepository {
  return {
    get: (projectId, id) => getProjectFindingSupabase(db, userId, projectId, id),
    list: (projectId) => listProjectFindingsSupabase(db, userId, projectId),
    transition: (projectId, id, status, from) => updateFindingStatusSupabase(db, userId, projectId, id, status, from),
    refresh: (projectId, id, input) => refreshFindingSupabase(db, userId, projectId, id, input),
  };
}
