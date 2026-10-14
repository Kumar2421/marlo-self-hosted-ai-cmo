import type { LlmDriver } from "@/lib/llm";
import { tavilySearchRaw } from "@/lib/domain/shared/webSearchTool";
import { googleSearchRaw } from "@/lib/domain/shared/googleSearch";
import { applyExclusions, type LeadProfile } from "./leadProfile.ts";
import { dedupeProfiles, MAX_LEADS, rankProfiles, type FitTarget } from "./leadFit.ts";
import {
  buildLinkedInQueries,
  collectProfiles,
  describeFailure,
  fillMissingCompanies,
  GOOGLE_RESULTS_PER_QUERY,
  RESULTS_PER_QUERY,
} from "./leadSearchCore.ts";
import type { ParsedLinkedInProfile } from "./profileParse.ts";

function withoutExcluded(list: ParsedLinkedInProfile[], exclude: string[]): ParsedLinkedInProfile[] {
  const allowed = new Set(applyExclusions(list.map((p) => toLead(p, p.company)), exclude).map((l) => l.sourceUrl));
  return list.filter((p) => allowed.has(p.sourceUrl));
}

export type LeadSearchQuery = {
  role: string;
  companyOrIndustry: string;
  location: string;
};

export type ExtractedLead = {
  name: string;
  title: string;
  company: string;
  location: string;
  email: string | null;
  sourceUrl: string | null;
};

function toLead(p: ParsedLinkedInProfile, company: string | null): ExtractedLead {
  return {
    name: p.name,
    title: p.title,
    company: company ?? "",
    location: p.location,
    email: null,
    sourceUrl: p.sourceUrl,
  };
}

/**
 * Real lead search. Every candidate comes from a real web result: Tavily's
 * LinkedIn-targeted queries (plus Google CSE for the first query when it is
 * configured). Each result is parsed by rules (profileParse.ts), non-person
 * pages are dropped, the rest are ranked deterministically (leadFit.ts), and
 * only the profiles still missing a company go to a small LLM call that may
 * name the employer from the profile's own text. The LLM is optional: if it
 * fails, the leads are still returned with an empty company.
 */
export class LeadsAgent {
  constructor(private driver: LlmDriver, private apiKey: string, private baseUrl?: string) {}

  async search(
    query: LeadSearchQuery,
    tavilyApiKey: string,
    model: string,
    google?: { apiKey: string; cx: string },
    /** The user's confirmed lead profile: guides relevance and removes excluded companies. */
    profile?: LeadProfile
  ): Promise<ExtractedLead[]> {
    const target: FitTarget = { role: query.role, companyOrIndustry: query.companyOrIndustry, location: query.location };
    const queries = buildLinkedInQueries(target);
    if (queries.length === 0) return [];

    const { profiles } = await collectProfiles(
      queries,
      {
        tavily: (q) => tavilySearchRaw(tavilyApiKey, q, RESULTS_PER_QUERY),
        google: google ? (q) => googleSearchRaw(google.apiKey, google.cx, q, GOOGLE_RESULTS_PER_QUERY) : undefined,
      },
      { queryLocation: query.location }
    );

    // Exclusions by name, URL and email domain are known before any LLM call,
    // so excluded people never cost tokens. The company check runs again below.
    const ranked = rankProfiles(profiles, target, profile);
    const candidates = profile ? withoutExcluded(ranked, profile.exclude) : ranked;
    if (candidates.length === 0) return [];

    const fill = await fillMissingCompanies(this.driver, candidates, {
      apiKey: this.apiKey,
      model,
      baseUrl: this.baseUrl,
    }).catch((err) => ({ companies: new Map<number, string>(), error: describeFailure(err, this.apiKey), calls: 0, promptTokens: 0 }));
    if (fill.error) console.warn(`[leads] company fill-in stopped early: ${fill.error}`);

    const filled = candidates.map((p, i) => ({ ...p, company: p.company ?? fill.companies.get(i) ?? null }));
    const unique = dedupeProfiles(filled).slice(0, MAX_LEADS).map((p) => toLead(p, p.company));
    return profile ? applyExclusions(unique, profile.exclude).slice(0, MAX_LEADS) : unique;
  }
}
