import { applyRecheck, type FindingRepository } from "../findings/findingService.ts";
import type { Finding } from "../findings/findingTypes.ts";
import { verifyFinding } from "../findings/verifyFinding.ts";
import { deriveGeoGapFindings, GEO_GAP_CATEGORY, GEO_GAP_SOURCE, geoGapVerdict, type GeoGapFindingInput, type GeoGapProject, type GapOptions } from "./geoGaps.ts";
import { normalizePrompt } from "./promptSet.ts";
import type { AnswerMethod, GeoRunRow } from "./types.ts";

/**
 * After a GEO run has saved its rows: verify open gap findings against the new runs, then
 * upsert the gaps that are still open. Idempotent: findings are keyed by identity (entityId
 * 'geo-gap:<normalized prompt>'), a rerun with the same rows changes nothing but last_seen.
 */

export type UpsertGapFinding = {
  projectId: string;
  source: string;
  category: string;
  severity: "warning";
  entityType: string;
  entityId: string;
  url: string | null;
  evidence: Record<string, unknown>;
  recommendation: string;
};

export type GapSyncPorts = {
  projectId: string;
  runs(): Promise<GeoRunRow[]>;
  activePrompts(): Promise<string[]>;
  listFindings(): Promise<Finding[]>;
  upsert(input: UpsertGapFinding): Promise<Finding>;
  repository: FindingRepository;
};

export type GapSyncSummary = { upserted: number; verified: number; failed: number; pending: number };

export function toUpsertInput(projectId: string, gap: GeoGapFindingInput): UpsertGapFinding {
  return {
    projectId,
    source: gap.source,
    category: gap.category,
    severity: gap.severity,
    entityType: gap.entityType,
    entityId: gap.entityId,
    url: gap.url,
    evidence: { ...gap.evidence, title: gap.title },
    recommendation: gap.recommendation,
  };
}

export async function syncGeoGapFindings(ports: GapSyncPorts, project: GeoGapProject, now: Date, options: GapOptions = {}): Promise<GapSyncSummary> {
  const summary: GapSyncSummary = { upserted: 0, verified: 0, failed: 0, pending: 0 };
  const [runs, prompts, all] = await Promise.all([ports.runs(), ports.activePrompts(), ports.listFindings()]);
  const gaps = all.filter((f) => f.source === GEO_GAP_SOURCE && f.category === GEO_GAP_CATEGORY);
  const ignoreRunsBefore: Record<string, string> = { ...options.ignoreRunsBefore };

  for (const f of gaps) {
    const key = f.entityId.slice("geo-gap:".length);
    if (f.status === "verified") {
      if (f.resolvedAt) ignoreRunsBefore[key] = f.resolvedAt;
      continue;
    }
    const prompt = typeof f.evidence.prompt === "string" ? f.evidence.prompt : key;
    const method = f.evidence.method === "simulated" ? "simulated" : ("gemini-grounded" as AnswerMethod);
    const result = await verifyFinding(
      { runSeoAudit: async () => [], runGeoReadiness: async () => [], geoGapVerdict: async (x) => geoGapVerdict(runs, prompt, method, x.firstSeen ?? f.firstSeen) },
      f,
      now,
    );
    if (result.outcome === "verified") {
      await applyRecheck(ports.repository, ports.projectId, f.id, {
        severity: f.severity,
        evidence: { ...f.evidence, verification: { outcome: "verified", reason: result.reason, checkedAt: result.checkedAt } },
        recommendation: f.recommendation,
        issueDetected: false,
      });
      ignoreRunsBefore[normalizePrompt(prompt)] = now.toISOString();
      summary.verified++;
    } else if (result.outcome === "failed" && f.status === "fixed") {
      // The user said it was fixed and later answers still miss them.
      await applyRecheck(ports.repository, ports.projectId, f.id, {
        severity: f.severity,
        evidence: { ...f.evidence, verification: { outcome: "failed", reason: result.reason, checkedAt: result.checkedAt } },
        recommendation: f.recommendation,
        issueDetected: true,
      });
      summary.failed++;
    } else {
      summary.pending++;
    }
  }

  for (const gap of deriveGeoGapFindings(runs, prompts, project, { ...options, ignoreRunsBefore })) {
    await ports.upsert(toUpsertInput(ports.projectId, gap));
    summary.upserted++;
  }
  return summary;
}
