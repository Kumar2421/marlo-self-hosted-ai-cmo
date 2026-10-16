import type { SupabaseClient } from "@supabase/supabase-js";
import { SEOAgent } from "../seo/SEOAgent.ts";
import { checkReadiness } from "../geo/geoService.ts";
import { listProjectFindings, mapFinding, updateFindingStatus, upsertFinding } from "./findingStoreSupabase.ts";
import { listFixedFindingRows } from "./fixedFindingRows.ts";
import { AUTO_VERIFY_MARKER_PREFIX, autoVerifyDocType, runAutoVerify, type AutoVerifyMarker, type AutoVerifyPorts, type FixedFinding, type ProjectScope } from "./autoVerifyJob.ts";
import { MONITOR_MANY_PROJECTS_MIN_MS, runMonitorAudit, type MonitorPorts, type MonitorScope } from "./monitorAudit.ts";
import type { VerifyCheckPorts } from "./verifyFinding.ts";
import type { AuditFindingInput } from "./auditFindings.ts";

/**
 * Platform (Supabase) wiring for the verify and monitor jobs. The job cores
 * stay store-agnostic; this file is the only place that knows the tables.
 * Markers reuse project_documents (unique per project and doc_type), the same
 * pattern as the social and proposal jobs. Every query is scoped explicitly.
 */

export const MONITOR_MARKER = "monitor_audit";
const ID_CHUNK = 200;

type ServiceDb = SupabaseClient;

/**
 * Background audits never use a PageSpeed key: a PSI call takes 15-40 s and
 * cannot be aborted, which would overrun the cron. A crawl-only audit is used
 * instead, and PageSpeed-only findings are skipped (see needsPageSpeed).
 */
function backgroundSeoAgent(): SEOAgent {
  return new SEOAgent();
}

/** Fresh-check ports for one finding: the real SEO audit and GEO readiness checks. */
export function platformCheckPorts(): VerifyCheckPorts {
  return {
    runSeoAudit: async (url) => (await backgroundSeoAgent().audit(url)).findings,
    runGeoReadiness: async (url) => (await checkReadiness(new URL(url).hostname)).checks,
  };
}

/** Fixed findings with the saved results of their completed actions. */
async function listFixedFindings(db: ServiceDb): Promise<FixedFinding[]> {
  const rows = await listFixedFindingRows(db);

  const resultsByFinding = new Map<string, Array<Record<string, unknown> | null>>();
  for (let i = 0; i < rows.length; i += ID_CHUNK) {
    const ids = rows.slice(i, i + ID_CHUNK).map((row) => row.id);
    const { data: actions, error: actionError } = await db.from("actions").select("finding_id, result").in("finding_id", ids).eq("status", "completed");
    if (actionError) throw new Error(actionError.message);
    for (const action of actions ?? []) {
      const key = String(action.finding_id);
      const list = resultsByFinding.get(key) ?? [];
      list.push((action.result ?? null) as Record<string, unknown> | null);
      resultsByFinding.set(key, list);
    }
  }

  return rows.map((row) => ({
    userId: String(row.user_id),
    projectId: String(row.project_id),
    finding: mapFinding(row),
    actionResults: resultsByFinding.get(String(row.id)) ?? [],
  }));
}

async function readMarkers(db: ServiceDb, scope: ProjectScope): Promise<Map<string, AutoVerifyMarker>> {
  const { data, error } = await db
    .from("project_documents")
    .select("doc_type, content")
    .eq("user_id", scope.userId)
    .eq("project_id", scope.projectId)
    .like("doc_type", `${AUTO_VERIFY_MARKER_PREFIX}%`);
  if (error) throw new Error(error.message);
  const markers = new Map<string, AutoVerifyMarker>();
  for (const row of data ?? []) {
    try {
      const parsed = JSON.parse(String(row.content ?? "{}")) as Partial<AutoVerifyMarker>;
      if (typeof parsed.attempts === "number" && typeof parsed.lastCheckedAt === "string") {
        markers.set(String(row.doc_type).slice(AUTO_VERIFY_MARKER_PREFIX.length), { attempts: parsed.attempts, lastCheckedAt: parsed.lastCheckedAt });
      }
    } catch {
      // A malformed marker counts as no marker.
    }
  }
  return markers;
}

async function writeDocument(db: ServiceDb, scope: ProjectScope, docType: string, content: string, now: Date): Promise<void> {
  const stamp = now.toISOString();
  const { error } = await db.from("project_documents").upsert(
    { user_id: scope.userId, project_id: scope.projectId, doc_type: docType, status: "ready", content, created_at: stamp, updated_at: stamp },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
}

export function autoVerifyPortsPlatform(db: ServiceDb, now: Date): AutoVerifyPorts {
  return {
    listFixedFindings: () => listFixedFindings(db),
    readMarkers: (scope) => readMarkers(db, scope),
    writeMarker: (scope, findingId, marker) => writeDocument(db, scope, autoVerifyDocType(findingId), JSON.stringify(marker), now),
    checkPorts: () => platformCheckPorts(),
    finalize: async (item, status, evidence) => {
      // One guarded update prevents status/evidence drift if a write is interrupted.
      const stamp = new Date().toISOString();
      const { data, error } = await db.from("findings").update({
        status,
        evidence,
        last_seen: stamp,
        resolved_at: status === "verified" ? stamp : null,
      }).eq("user_id", item.userId).eq("project_id", item.projectId).eq("id", item.finding.id).eq("status", "fixed").select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Finding was not in fixed status; auto-verification result was not saved.");
    },
    transition: async (item, status) => {
      await updateFindingStatus(db, item.userId, item.projectId, item.finding.id, status);
    },
    saveEvidence: async (item, evidence) => {
      const { error } = await db.from("findings").update({ evidence }).eq("user_id", item.userId).eq("project_id", item.projectId).eq("id", item.finding.id);
      if (error) throw new Error(error.message);
    },
  };
}

/** Projects with a site URL, with the time of their last monitor pass (the marker row's updated_at). */
export async function monitorTargetsPlatform(db: ServiceDb): Promise<MonitorScope[]> {
  const { data: projects, error } = await db.from("projects").select("id, owner_id, url").not("url", "is", null);
  if (error) throw new Error(error.message);
  const { data: markers, error: markerError } = await db.from("project_documents").select("project_id, updated_at").eq("doc_type", MONITOR_MARKER);
  if (markerError) throw new Error(markerError.message);
  const lastRun = new Map((markers ?? []).map((m) => [String(m.project_id), String(m.updated_at)]));
  return (projects ?? []).map((p) => ({
    userId: String(p.owner_id),
    projectId: String(p.id),
    siteUrl: String(p.url),
    lastRunAt: lastRun.get(String(p.id)) ?? null,
  }));
}

export function monitorPortsPlatform(db: ServiceDb, now: Date): MonitorPorts {
  return {
    listTargets: () => monitorTargetsPlatform(db),
    knownFindings: (scope) => listProjectFindings(db, scope.userId, scope.projectId),
    audit: async (scope, url) => {
      const audit = await backgroundSeoAgent().audit(url);
      return { url: audit.url, findings: audit.findings };
    },
    upsert: (scope, input: AuditFindingInput) => upsertFinding(db, scope.userId, input),
    writeMarker: (scope) => writeDocument(db, scope, MONITOR_MARKER, "{}", now),
  };
}

export type VerifyPhaseSummary = { verified: number; failed: number; skipped: number; monitored: number };

/**
 * Phase 4 of the cron: auto-verify fixes first, then the weekly regression
 * watch with whatever budget is left. Each background audit has a hard
 * timeout and only starts with enough budget for it (timedAudit.ts). Counts
 * only leave this function.
 */
export async function runVerifyAndMonitorPlatform(db: ServiceDb, now: Date, budgetMs: number): Promise<VerifyPhaseSummary> {
  const started = Date.now();
  const verify = await runAutoVerify(autoVerifyPortsPlatform(db, now), now, { budgetMs, maxItems: 10 });
  const monitor = await runMonitorAudit(monitorPortsPlatform(db, now), now, {
    budgetMs: Math.max(0, budgetMs - (Date.now() - started)),
    maxAudits: budgetMs >= MONITOR_MANY_PROJECTS_MIN_MS ? 6 : 3,
  });
  return { verified: verify.verified, failed: verify.failed, skipped: verify.skipped, monitored: monitor.monitored };
}
