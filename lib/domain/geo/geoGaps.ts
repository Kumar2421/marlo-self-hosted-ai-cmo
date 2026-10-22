import { normalizePrompt } from "./promptSet.ts";
import type { AnswerMethod, GeoRunRow } from "./types.ts";

/**
 * AI-answer gaps as trackable findings. Pure: no I/O.
 *
 * Honesty rules (same as the rest of GEO):
 *  - Only stored rows are evidence. A failed or timed-out call stores no row, so it is "not measured",
 *    never a gap.
 *  - One method per finding. A real Gemini answer wins over the simulated stand-in when both exist,
 *    and the two are never counted together.
 *  - A gap closes only when a LATER run of the same prompt and method names the project.
 */

export const GEO_GAP_SOURCE = "geo";
export const GEO_GAP_CATEGORY = "geo_gap";
export const GEO_GAP_ENTITY_TYPE = "prompt";
export const GEO_GAP_ENTITY_PREFIX = "geo-gap:";

export type GapOptions = {
  /** How many of the most recent runs are considered. */
  window?: number;
  /** Misses needed inside the window when more than one run exists. */
  minMisses?: number;
  /** Per prompt (normalized), ignore runs at or before this ISO time (a verified gap needs fresh evidence to reopen). */
  ignoreRunsBefore?: Record<string, string>;
};

export const DEFAULT_GAP_WINDOW = 3;
export const DEFAULT_GAP_MIN_MISSES = 2;

export type GeoGapProject = { name: string; domain: string; url?: string };

export type GeoGapEvidence = {
  prompt: string;
  method: AnswerMethod;
  engine: string;
  runs: { considered: number; notMentioned: number; mentioned: number };
  namedInstead: string[];
  sources: string[];
  lastRunAt: string;
};

export type GeoGapFindingInput = {
  projectId?: string;
  source: typeof GEO_GAP_SOURCE;
  category: typeof GEO_GAP_CATEGORY;
  severity: "warning";
  entityType: typeof GEO_GAP_ENTITY_TYPE;
  entityId: string;
  url: string | null;
  title: string;
  evidence: GeoGapEvidence;
  recommendation: string;
};

export function geoGapEntityId(prompt: string): string {
  return `${GEO_GAP_ENTITY_PREFIX}${normalizePrompt(prompt)}`;
}

export function isGeoGapEntityId(entityId: string): boolean {
  return entityId.startsWith(GEO_GAP_ENTITY_PREFIX);
}

function domainOf(url: string): string | null {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function topByCount(values: string[], max: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([v]) => v);
}

export function topCompetitors(runs: Pick<GeoRunRow, "competitors">[], max = 3): string[] {
  return topByCount(runs.flatMap((r) => [...new Set(r.competitors)]), max);
}

/** Most-cited source domains (one count per run), excluding the project's own domain. */
export function topSourceDomains(runs: Pick<GeoRunRow, "sources">[], ownDomain: string, max = 3): string[] {
  const own = ownDomain.replace(/^www\./, "").toLowerCase();
  const domains = runs.flatMap((r) => [...new Set(r.sources.map(domainOf).filter((d): d is string => Boolean(d) && d !== own))]);
  return topByCount(domains, max);
}

export function geoGapRecommendation(e: Pick<GeoGapEvidence, "prompt" | "namedInstead" | "sources" | "method">, project: GeoGapProject): string {
  const parts: string[] = [];
  parts.push(
    e.namedInstead.length > 0
      ? `When the AI was asked "${e.prompt}", it named ${e.namedInstead.join(", ")} instead of ${project.name}.`
      : `When the AI was asked "${e.prompt}", it did not name ${project.name}.`,
  );
  if (e.sources.length > 0) {
    parts.push(`It drew on ${e.sources.join(", ")}. Get ${project.name} listed or mentioned there (a listing, a review, a comparison or a guest article), since those are the pages the AI reads for this question.`);
  }
  parts.push(`Publish a page on ${project.domain} that answers this exact question directly, with a short FAQ, and name ${project.name} and what it does in the first paragraph.`);
  parts.push("Then run the check again; this finding is verified when a later answer names you.");
  if (e.method === "simulated") parts.push("Note: this was measured with the simulated method (search results plus a free model), not a real assistant.");
  return parts.join(" ");
}

function preferredMethod(rows: GeoRunRow[]): AnswerMethod | null {
  if (rows.some((r) => r.method === "gemini-grounded")) return "gemini-grounded";
  if (rows.some((r) => r.method === "simulated")) return "simulated";
  return null;
}

/**
 * One finding input per ACTIVE prompt whose recent measured runs miss the project.
 * `runs` may hold any prompts and methods; rows of other prompts and the non-preferred method are ignored.
 */
export function deriveGeoGapFindings(
  runs: GeoRunRow[],
  activePromptList: string[],
  project: GeoGapProject,
  options: GapOptions = {},
): GeoGapFindingInput[] {
  const window = options.window ?? DEFAULT_GAP_WINDOW;
  const minMisses = options.minMisses ?? DEFAULT_GAP_MIN_MISSES;
  const out: GeoGapFindingInput[] = [];
  const seen = new Set<string>();

  for (const prompt of activePromptList) {
    const key = normalizePrompt(prompt);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const since = options.ignoreRunsBefore?.[key];
    const own = runs.filter((r) => normalizePrompt(r.prompt) === key && (!since || r.runAt > since));
    const method = preferredMethod(own);
    if (!method) continue; // never run (or all failed): not measured, not a gap

    const recent = own.filter((r) => r.method === method).sort((a, b) => (a.runAt < b.runAt ? 1 : a.runAt > b.runAt ? -1 : 0)).slice(0, window);
    const misses = recent.filter((r) => !r.mentioned);
    // The newest answer must also miss: a mention since then means the gap is already closing.
    if (recent.length === 0 || recent[0].mentioned) continue;
    const needed = recent.length === 1 ? 1 : Math.min(minMisses, recent.length);
    if (misses.length < needed) continue;

    const evidence: GeoGapEvidence = {
      prompt,
      method,
      engine: recent[0].engine,
      runs: { considered: recent.length, notMentioned: misses.length, mentioned: recent.length - misses.length },
      namedInstead: topCompetitors(misses),
      sources: topSourceDomains(misses, project.domain),
      lastRunAt: recent[0].runAt,
    };
    out.push({
      source: GEO_GAP_SOURCE,
      category: GEO_GAP_CATEGORY,
      severity: "warning",
      entityType: GEO_GAP_ENTITY_TYPE,
      entityId: geoGapEntityId(prompt),
      url: project.url ?? `https://${project.domain}/`,
      title: `AI answers to "${prompt}" don't mention you`,
      evidence,
      recommendation: geoGapRecommendation(evidence, project),
    });
  }
  return out;
}

export type GapVerdict = "mentioned" | "not-mentioned" | "no-new-runs";

/** Verify rule: a real run of this prompt (same method) AFTER the finding was first seen. */
export function geoGapVerdict(runs: GeoRunRow[], prompt: string, method: AnswerMethod, firstSeen: string): GapVerdict {
  const key = normalizePrompt(prompt);
  const later = runs.filter((r) => normalizePrompt(r.prompt) === key && r.method === method && r.runAt > firstSeen);
  if (later.length === 0) return "no-new-runs";
  return later.some((r) => r.mentioned) ? "mentioned" : "not-mentioned";
}
