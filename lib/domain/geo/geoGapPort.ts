import type { VerifyCheckPorts } from "../findings/verifyFinding.ts";
import { geoGapVerdict } from "./geoGaps.ts";
import type { AnswerMethod, GeoRunRow } from "./types.ts";

/**
 * The geoGapVerdict port for verifyFinding, backed by STORED geo_runs only: it never calls a
 * provider and never spends a user's daily cap. `loadRuns(sinceIso)` is the store read
 * (geoStore.listRuns for SQLite, geoStoreSupabase.listRuns for the platform).
 */
export function storedGeoGapVerdictPort(loadRuns: (sinceIso: string) => Promise<GeoRunRow[]> | GeoRunRow[]): NonNullable<VerifyCheckPorts["geoGapVerdict"]> {
  return async (finding) => {
    const evidence = finding.evidence ?? {};
    const key = finding.entityId.replace(/^geo-gap:/, "");
    const prompt = typeof evidence.prompt === "string" ? evidence.prompt : key;
    // Same method rule as the gap sync: an untagged finding is the real (grounded) method.
    const method: AnswerMethod = evidence.method === "simulated" ? "simulated" : "gemini-grounded";
    const firstSeen = finding.firstSeen ?? "";
    if (!firstSeen) return "no-new-runs";
    // Only rows after first_seen can count, so only those are read.
    const runs = await loadRuns(firstSeen);
    return geoGapVerdict(runs, prompt, method, firstSeen);
  };
}

export type { GeoRunRow };
