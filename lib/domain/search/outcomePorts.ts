import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import {
  getProjectAction, resetAction, setActionResult, transitionAction,
} from "@/lib/domain/actions/actionStore";
import {
  getProjectAction as getProjectActionSupabase, resetAction as resetActionSupabase,
  setActionResult as setActionResultSupabase, transitionAction as transitionActionSupabase,
} from "@/lib/domain/actions/actionStoreSupabase";
import { sqliteFindingRepository, supabaseFindingRepository } from "@/lib/domain/findings/findingRepositories";
import { transitionFinding } from "@/lib/domain/findings/findingService";
import { getProjectFinding } from "@/lib/domain/findings/findingStore";
import { getProjectFinding as getProjectFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import { fetchPageFingerprint } from "./pageFingerprint";
import type { OutcomePorts } from "./outcomeService";
import { getLatestSnapshot, getSnapshotOnOrBefore } from "./searchSnapshotStore";
import { getLatestSnapshot as getLatestSnapshotSupabase, getSnapshotOnOrBefore as getSnapshotOnOrBeforeSupabase } from "./searchSnapshotStoreSupabase";

/** Platform (Supabase) wiring for the outcome service; every call is scoped to one user and project. */
export function platformOutcomePorts(db: SupabaseClient, userId: string, projectId: string, projectUrl: string | null): OutcomePorts {
  const findings = supabaseFindingRepository(db, userId);
  return {
    projectUrl,
    getAction: (id) => getProjectActionSupabase(db, userId, projectId, id),
    getFinding: (id) => getProjectFindingSupabase(db, userId, projectId, id),
    getSnapshot: async () => {
      const latest = await getLatestSnapshotSupabase(db, userId, projectId);
      return latest ? { snapshotDate: latest.snapshotDate, payload: latest.payload } : null;
    },
    getSnapshotOnOrBefore: async (date) => {
      const found = await getSnapshotOnOrBeforeSupabase(db, userId, projectId, date);
      return found ? { snapshotDate: found.snapshotDate, payload: found.payload } : null;
    },
    completeAction: (id, result) => transitionActionSupabase(db, userId, projectId, id, "completed", result),
    saveResult: (id, result) => setActionResultSupabase(db, userId, projectId, id, result),
    resetAction: (id) => resetActionSupabase(db, userId, projectId, id),
    moveFinding: async (id, status) => {
      await transitionFinding(findings, projectId, id, status);
    },
    fetchFingerprint: (url) => fetchPageFingerprint(url),
  };
}

/** Self-host (SQLite) wiring, same contract. */
export function selfHostOutcomePorts(projectId: string, projectUrl: string | null): OutcomePorts {
  const findings = sqliteFindingRepository();
  return {
    projectUrl,
    getAction: async (id) => getProjectAction(projectId, id),
    getFinding: async (id) => getProjectFinding(projectId, id),
    getSnapshot: async () => {
      const latest = getLatestSnapshot(getDb(), projectId);
      return latest ? { snapshotDate: latest.snapshotDate, payload: latest.payload } : null;
    },
    getSnapshotOnOrBefore: async (date) => {
      const found = getSnapshotOnOrBefore(getDb(), projectId, date);
      return found ? { snapshotDate: found.snapshotDate, payload: found.payload } : null;
    },
    completeAction: async (id, result) => transitionAction(projectId, id, "completed", result),
    saveResult: async (id, result) => setActionResult(projectId, id, result),
    resetAction: async (id) => resetAction(projectId, id),
    moveFinding: async (id, status) => {
      await transitionFinding(findings, projectId, id, status);
    },
    fetchFingerprint: (url) => fetchPageFingerprint(url),
  };
}
