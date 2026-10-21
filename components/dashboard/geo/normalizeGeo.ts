/** Defensive readers for the GEO endpoints. Production can answer with partial or error-shaped JSON; a section should show an empty state, not crash. */
import type { GeoOverview, PromptRow } from "@/lib/domain/geo/geoService";
import type { GeoRunRow } from "@/lib/domain/geo/types";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export type GeoCheck = { id: string; label: string; status: "pass" | "fail" | "unknown"; detail: string; fix: string };

export function normalizeGeoChecks(data: unknown): { domain: string; score: number; checks: GeoCheck[] } {
  const d = obj(data);
  return {
    domain: typeof d.domain === "string" ? d.domain : "",
    score: num(d.score),
    checks: list<Obj>(d.checks)
      .filter((c) => c && typeof c === "object" && typeof c.id === "string")
      .map((c) => ({
        id: c.id as string,
        label: typeof c.label === "string" ? c.label : (c.id as string),
        status: c.status === "pass" || c.status === "fail" ? c.status : "unknown",
        detail: typeof c.detail === "string" ? c.detail : "",
        fix: typeof c.fix === "string" ? c.fix : "",
      })),
  };
}

export function normalizeReferral(data: unknown): { total: number; bySource: Array<{ source: string; sessions: number }> } {
  const d = obj(data);
  return {
    total: num(d.total),
    bySource: list<Obj>(d.bySource).map((s) => ({ source: String(s?.source ?? ""), sessions: num(s?.sessions) })),
  };
}

/** Anything that is not an array of runs becomes []; each run keeps its shape with competitors defaulting to []. */
export function normalizeRuns(data: unknown): GeoRunRow[] {
  return list<Obj>(obj(data).runs)
    .filter((r) => r && typeof r === "object")
    .map((r) => ({ ...r, competitors: list<string>(r.competitors) }) as unknown as GeoRunRow);
}

/** Prompts, methods and competitors default to []; lastRunAt and capabilities to null. */
export function normalizeOverview(data: unknown): GeoOverview {
  const d = obj(data);
  return {
    project: { name: "", domain: "", ...obj(d.project) },
    prompts: list<Obj>(d.prompts)
      .filter((p) => p && typeof p.prompt === "string")
      .map((p) => ({
        ...p,
        active: p.active !== false,
        methods: list<Obj>(p.methods).map((m) => ({ ...m, runs: num(m.runs), mentionRate: num(m.mentionRate), competitors: list<string>(m.competitors) })),
      })) as unknown as PromptRow[],
    capabilities: (d.capabilities && typeof d.capabilities === "object" ? d.capabilities : null) as unknown as GeoOverview["capabilities"],
    lastRunAt: typeof d.lastRunAt === "string" ? d.lastRunAt : null,
  };
}
