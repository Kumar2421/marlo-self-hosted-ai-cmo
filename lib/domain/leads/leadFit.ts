import type { ParsedLinkedInProfile } from "./profileParse.ts";
import type { LeadProfile } from "./leadProfile.ts";

/** What the search asked for (the form fields, or the daily profile pick). */
export type FitTarget = { role: string; companyOrIndustry: string; location: string };

/** Fewer than this and the profile is not relevant enough to keep. */
export const MIN_FIT_SCORE = 2;
export const MAX_LEADS = 40;

const STOPWORDS = new Set(["of", "and", "the", "for", "at", "in", "with", "a", "an", "or", "to", "on", "by", "&"]);

/** Lowercase word tokens, dropping stopwords and single characters. */
export function fitTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return [...new Set(words.filter((w) => w.length >= 2 && !STOPWORDS.has(w)))];
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

/** Count how many of the wanted tokens appear as whole words in the text. */
function hits(wanted: string[], words: Set<string>): number {
  return wanted.filter((w) => words.has(w)).length;
}

export type FitScore = { score: number; keep: boolean; roleHits: number };

/**
 * Deterministic relevance. Points: role words matched in headline/title
 * (the main signal), seniority words, location (city/state tokens), industry
 * words in headline/description, and the same three from the saved lead
 * profile. A profile without any role match is dropped when a role was asked
 * for, so a generic "Marketing" headline cannot pass a "Head of Sales" search.
 */
export function scoreProfile(p: ParsedLinkedInProfile, target: FitTarget, profile?: Pick<LeadProfile, "roles" | "industries" | "locations"> | null): FitScore {
  const haystack = `${p.headline} ${p.title} ${p.description}`;
  const words = wordSet(haystack);
  const seniorityWords = wordSet(p.seniority);

  const roleTokens = fitTokens(target.role);
  const profileRoleTokens = fitTokens((profile?.roles ?? []).join(" "));
  const roleHits = hits(roleTokens, words);
  const profileRoleHits = hits(profileRoleTokens, words);
  const seniorityHit = hits(roleTokens, seniorityWords) > 0 ? 1 : 0;

  const locationTokens = fitTokens(`${target.location} ${(profile?.locations ?? []).join(" ")}`);
  const locationWords = wordSet(p.location);
  const locationHit = locationTokens.length > 0 && hits(locationTokens, locationWords) > 0 ? 1 : 0;

  const industryTokens = fitTokens(`${target.companyOrIndustry} ${(profile?.industries ?? []).join(" ")}`);
  const industryHit = industryTokens.length > 0 && hits(industryTokens, words) > 0 ? 1 : 0;

  const roleAsked = roleTokens.length > 0 || profileRoleTokens.length > 0;
  const roleMatched = roleHits > 0 || profileRoleHits > 0;
  const score = Math.min(3, roleHits) * 2 + (profileRoleHits > 0 ? 2 : 0) + seniorityHit + locationHit * 2 + industryHit * 2;

  const keep = score >= MIN_FIT_SCORE && (!roleAsked || roleMatched);
  return { score, keep, roleHits };
}

type FitProfile = Pick<LeadProfile, "roles" | "industries" | "locations"> | null | undefined;

/**
 * One plain sentence on why this profile fits, built only from words that actually matched (never invented):
 * "Head of Sales at Acme. Matches your 'sales' role; based in Chennai." Empty when nothing matched.
 */
export function describeFit(p: ParsedLinkedInProfile, target: FitTarget, profile?: FitProfile): string {
  const words = wordSet(`${p.headline} ${p.title} ${p.description}`);
  const matchedRole = [...new Set([...fitTokens(target.role), ...fitTokens((profile?.roles ?? []).join(" "))])].filter((w) => words.has(w));
  const matchedIndustry = [...new Set([...fitTokens(target.companyOrIndustry), ...fitTokens((profile?.industries ?? []).join(" "))])].filter((w) => words.has(w));
  const locationWords = wordSet(p.location);
  const matchedPlace = fitTokens(`${target.location} ${(profile?.locations ?? []).join(" ")}`).filter((w) => locationWords.has(w));

  const parts: string[] = [];
  if (matchedRole.length) parts.push(`role matches "${matchedRole.slice(0, 3).join(" ")}"`);
  if (matchedIndustry.length) parts.push(`works in "${matchedIndustry.slice(0, 3).join(" ")}"`);
  if (matchedPlace.length) parts.push(`based in ${p.location}`);
  if (parts.length === 0) return "";
  const who = [p.title, p.company].filter(Boolean).join(" at ");
  return `${who ? `${who}. ` : ""}${parts[0][0].toUpperCase()}${parts.join("; ").slice(1)}.`;
}

/** Same person under two URL spellings, or the same name at the same company. */
function dedupeKeys(p: ParsedLinkedInProfile): string[] {
  const keys = [`url:${p.sourceUrl.toLowerCase()}`];
  if (p.company) keys.push(`nc:${p.name.toLowerCase()}|${p.company.toLowerCase()}`);
  return keys;
}

/** Drop repeats (by profile URL, and by name+company when the company is known); first one wins. */
export function dedupeProfiles<T extends ParsedLinkedInProfile>(profiles: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of profiles) {
    const keys = dedupeKeys(p);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(p);
  }
  return out;
}

export type RankedProfile = ParsedLinkedInProfile & { score: number; fitReason: string };

/**
 * Keep the relevant profiles, dedupe, sort by score (stable, so the search
 * engine's order breaks ties), and cap at MAX_LEADS.
 */
export function rankProfiles(
  profiles: ParsedLinkedInProfile[],
  target: FitTarget,
  profile?: Pick<LeadProfile, "roles" | "industries" | "locations"> | null
): RankedProfile[] {
  const scored: RankedProfile[] = [];
  for (const p of profiles) {
    const fit = scoreProfile(p, target, profile);
    if (fit.keep) scored.push({ ...p, score: fit.score, fitReason: describeFit(p, target, profile) });
  }
  const sorted = scored
    .map((p, index) => ({ p, index }))
    .sort((a, b) => b.p.score - a.p.score || a.index - b.index)
    .map(({ p }) => p);
  return dedupeProfiles(sorted).slice(0, MAX_LEADS);
}
