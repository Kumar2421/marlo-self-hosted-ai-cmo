import { registrableLabel } from "../search/searchIntent.ts";
import type { AnswerMethod, EngineAnswer, GeoRunRow } from "./types.ts";

export type Subject = {
  brand: string;
  /** Bare domain, e.g. "example.com". */
  domain: string;
  /** Competitor names or domains. */
  competitors: string[];
};

export type RunAnalysis = { mentioned: boolean; cited: boolean; competitors: string[] };

function host(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/** Case-sensitive: "Linear" / "LINEAR" count, "linear" does not. */
function mentionsCapitalised(text: string, word: string): boolean {
  const w = word.trim();
  if (!w) return false;
  const forms = [...new Set([w[0].toUpperCase() + w.slice(1).toLowerCase(), w.toUpperCase()])].map(escapeRe).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms})(?![\\p{L}\\p{N}])`, "u").test(text);
}

/**
 * Everyday words that are also brand names. A single-word brand in this list
 * (or of 1-3 letters) is only counted when it is capitalised in the answer, or
 * when the answer also shows the brand's domain. Days and months are here so
 * "On Monday, use any tool" is not read as monday.com.
 */
const GENERIC_BRAND_WORDS = new Set([
  "apple", "linear", "go", "notion", "slack", "monday", "stripe", "square", "mint", "base", "front", "buffer", "loop", "zoom",
  "signal", "bolt", "ramp", "scale", "vector", "pilot", "spark", "flow", "bridge", "atlas", "compass", "beacon", "forge", "orbit",
  "nova", "pulse", "peak", "summit", "harvest", "canvas", "gather", "amazon", "target", "meta", "next", "open", "simple", "swift",
  "rust", "ruby", "python", "java", "sketch", "clear", "bright", "fresh", "smart", "rocket", "light", "wave", "link", "grow",
  "growth", "launch", "craft", "form", "forms", "trello", "asana", "basecamp", "airtable", "calendar", "mail", "post", "search",
  "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "march", "april", "may", "june", "july", "august",
]);

export function isGenericBrandWord(word: string): boolean {
  const w = word.trim().toLowerCase();
  return !/\s/.test(w) && (w.length <= 3 || GENERIC_BRAND_WORDS.has(w));
}

const LEGAL_SUFFIX = /[\s,]+(?:inc|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|pty|bv|sa|ag)\.?$/i;

/**
 * Names a project might be called in an answer: the text before " - ", " | " or ":" separators
 * ("Marlo - AI SEO Agent" -> "Marlo"), without legal suffixes ("Acme Inc." -> "Acme"), the full name,
 * and the domain label ("marlo.ai" -> "marlo"). Deduplicated, lowercase-insensitive.
 */
export function brandAliases(name: string, domain: string): string[] {
  const full = name.trim();
  const head = full.split(/\s+[-–—|]\s+|\s*[|:]\s*/)[0]?.trim() ?? "";
  const out: string[] = [];
  const add = (v: string) => {
    const t = v.replace(/^[\s.,;:'"-]+|[\s.,;:'"-]+$/g, "");
    if (t.length >= 2 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  let stripped = head;
  for (let i = 0; i < 2 && LEGAL_SUFFIX.test(stripped); i += 1) stripped = stripped.replace(LEGAL_SUFFIX, "");
  add(stripped);
  add(head);
  add(full);
  add(registrableLabel(domain));
  return out;
}

/**
 * How a term may match: "loose" = any case; "capitalised" = only as written with a capital;
 * "never" = not by word at all (domain/URL evidence only).
 */
function mentionsBrandWord(text: string, alias: string, genericAllowance: "capitalised" | "loose" | "never"): boolean {
  if (!isGenericBrandWord(alias) || genericAllowance === "loose") return mentionsTerm(text, alias);
  return genericAllowance === "capitalised" ? mentionsCapitalised(text, alias) : false;
}

function matchesDomain(h: string, domain: string): boolean {
  const d = domain.replace(/^www\./, "").toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** Mentioned = brand (or an alias of it) or domain named in the answer text. Cited = one of the sources is on your domain. */
export function analyzeAnswer(result: EngineAnswer, subject: Subject): RunAnalysis {
  const hosts = result.citedUrls.map(host).filter((h): h is string => !!h);
  const cited = hosts.some((h) => matchesDomain(h, subject.domain));
  const domainNamed = mentionsTerm(result.answer, subject.domain);
  // A common-word brand ("Linear") needs a capital, or proof it is meant: its domain in the text or among the sources.
  const allowance = domainNamed || cited ? "loose" : "capitalised";
  const mentioned = domainNamed || brandAliases(subject.brand, subject.domain).some((a) => mentionsBrandWord(result.answer, a, allowance));
  const competitors: string[] = [];
  for (const c of subject.competitors) {
    const bare = c.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
    const isDomain = bare.includes(".");
    // Competitors are usually stored as domains, but answers name the brand ("hubspot"), so match the first label too.
    // A common-word label ("monday") is never matched by word: only the domain or a cited URL proves it.
    const label = isDomain ? bare.split(".")[0] : "";
    const hit = isDomain
      ? mentionsTerm(result.answer, bare) ||
        hosts.some((h) => matchesDomain(h, bare)) ||
        (label.length >= 4 && mentionsBrandWord(result.answer, label, "never"))
      : mentionsBrandWord(result.answer, c, "capitalised");
    if (hit && !competitors.includes(c)) competitors.push(c);
  }
  return { mentioned, cited, competitors };
}

export type Aggregate = {
  method: AnswerMethod;
  runs: number;
  mentionRate: number;
  citedRate: number;
  /** Competitor name -> share of runs that named it. */
  competitorRates: Record<string, number>;
};

/** Rates over runs of ONE method. Methods are never mixed. */
export function aggregateRuns(
  runs: Pick<GeoRunRow, "method" | "mentioned" | "cited" | "competitors">[],
  method: AnswerMethod,
): Aggregate {
  const own = runs.filter((r) => r.method === method);
  const n = own.length;
  const competitorRates: Record<string, number> = {};
  for (const r of own) for (const c of new Set(r.competitors)) competitorRates[c] = (competitorRates[c] ?? 0) + 1;
  for (const c of Object.keys(competitorRates)) competitorRates[c] = competitorRates[c] / n;
  return {
    method,
    runs: n,
    mentionRate: n === 0 ? 0 : own.filter((r) => r.mentioned).length / n,
    citedRate: n === 0 ? 0 : own.filter((r) => r.cited).length / n,
    competitorRates,
  };
}

export const dayOf = (iso: string): string => iso.slice(0, 10);

/** One method's rates per day, newest first. */
export function ratesByDay(
  runs: Pick<GeoRunRow, "method" | "mentioned" | "cited" | "competitors" | "runAt">[],
  method: AnswerMethod,
): Array<{ date: string; runs: number; mentionRate: number; citedRate: number }> {
  const days = [...new Set(runs.filter((r) => r.method === method).map((r) => dayOf(r.runAt)))].sort().reverse();
  return days.map((date) => {
    const a = aggregateRuns(runs.filter((r) => dayOf(r.runAt) === date), method);
    return { date, runs: a.runs, mentionRate: a.mentionRate, citedRate: a.citedRate };
  });
}

export type Trend = "up" | "down" | "flat" | "new";

/**
 * Compare the latest day's mention rate with the previous day that has runs. Moves under 0.2 are noise at 3 runs.
 * The two dates are returned because the previous run day can be weeks back: callers must say which days were compared.
 */
export function compareTrend(
  runs: Pick<GeoRunRow, "method" | "mentioned" | "cited" | "competitors" | "runAt">[],
  method: AnswerMethod,
  threshold = 0.2,
): { trend: Trend; latest: number | null; previous: number | null; latestDate: string | null; previousDate: string | null } {
  const days = ratesByDay(runs, method);
  if (days.length === 0) return { trend: "new", latest: null, previous: null, latestDate: null, previousDate: null };
  if (days.length === 1) return { trend: "new", latest: days[0].mentionRate, previous: null, latestDate: days[0].date, previousDate: null };
  const [latest, previous] = days;
  const diff = latest.mentionRate - previous.mentionRate;
  return {
    trend: Math.abs(diff) < threshold ? "flat" : diff > 0 ? "up" : "down",
    latest: latest.mentionRate,
    previous: previous.mentionRate,
    latestDate: latest.date,
    previousDate: previous.date,
  };
}
