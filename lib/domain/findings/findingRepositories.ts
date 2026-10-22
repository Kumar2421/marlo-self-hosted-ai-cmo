import type { SupabaseClient } from "@supabase/supabase-js";
import type { FindingRepository } from "./findingService";
import type { VanishPorts } from "./vanishedFindings";
import {
  getProjectFinding,
  listProjectFindings,
  refreshFinding,
  updateFindingStatus,
  updateFindingEvidence,
} from "./findingStore";
import {
  getProjectFinding as getProjectFindingSupabase,
  listProjectFindings as listProjectFindingsSupabase,
  refreshFinding as refreshFindingSupabase,
  updateFindingStatus as updateFindingStatusSupabase,
  updateFindingEvidence as updateFindingEvidenceSupabase,
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

/** Ports for flagging vanished findings after an audit. */
export function sqliteVanishPorts(): VanishPorts {
  return {
    list: (projectId) => listProjectFindings(projectId),
    setEvidence: (f, evidence) => updateFindingEvidence(f.projectId, f.id, evidence, f.status),
  };
}

export function supabaseVanishPorts(db: SupabaseClient, userId: string): VanishPorts {
  return {
    list: (projectId) => listProjectFindingsSupabase(db, userId, projectId),
    setEvidence: (f, evidence) => updateFindingEvidenceSupabase(db, userId, f.projectId, f.id, evidence, f.status),
  };
}
