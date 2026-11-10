import type { SearchProvider, SearchHit } from "../../websearch/searchProvider.ts";
import type { Enrichment } from "../local/websiteContact.ts";
import { fitTokens } from "../leadFit.ts";
import { qualifyLead } from "../qualify.ts";
import { pickOutreachEmail } from "./companyEmail.ts";
import { pickCompanySites, type CompanyCandidate } from "./companySites.ts";

/**
 * Company leads from the open web, for a user who sells to businesses: search for companies in the kinds of
 * business and places the profile names, read each company's own site for a contact, and keep only the ones a
 * user can actually reach. All I/O comes in through ports, so the rules are tested with fakes.
 */

export type CompanyProfile = { industries: readonly string[]; locations: readonly string[]; problem?: string; exclude?: readonly string[] };

export type CompanyLeadDraft = {
  name: string;
  website: string;
  host: string;
  email: string | null;
  emailQuality: "source_found" | "domain_found" | null;
  whatsapp: string | null;
  contactUrl: string | null;
  description: string | null;
  /** The page a user can open to see the contact. */
  sourceUrl: string;
  fitReason: string;
};

export type CompanySearchPorts = {
  provider: SearchProvider;
  /** Hosts already saved as leads for this project. */
  knownHosts: () => Promise<Set<string>>;
  enrich: (website: string) => Promise<Enrichment>;
};

export type CompanySearchInput = {
  profile: CompanyProfile;
  /** The user's own site, never returned as a lead. */
  ownHost?: string;
  budgetMs?: number;
  concurrency?: number;
  maxLeads?: number;
};

export type CompanySearchResult = {
  leads: CompanyLeadDraft[];
  /** Companies found but dropped: no way to reach them, or nothing tying them to the profile. */
  droppedNoContact: number;
  droppedNoFit: number;
  duplicates: number;
};

export const COMPANY_BUDGET_MS = 30_000;
export const COMPANY_CONCURRENCY = 4;
const QUERY_LIMIT = 3;
const RESULTS_PER_QUERY = 10;
const CANDIDATE_CAP = 14;

/** Up to three web queries from the profile's company types and places, e.g. "dental clinics Chennai contact us". */
export function buildCompanyQueries(profile: Pick<CompanyProfile, "industries" | "locations">, max = QUERY_LIMIT): string[] {
  const industries = profile.industries.map((s) => s.trim()).filter(Boolean);
  const locations = profile.locations.length > 0 ? profile.locations.map((s) => s.trim()).filter(Boolean) : [""];
  const out: string[] = [];
  for (const industry of industries) {
    for (const location of locations) {
      out.push(`${industry} ${location} contact us`.replace(/\s+/g, " ").trim());
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** One sentence from words that really appear on the company's pages; empty when nothing ties it to the profile. */
export function describeCompanyFit(profile: Pick<CompanyProfile, "industries" | "locations">, text: string): string {
  const words = new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const industry = fitTokens(profile.industries.join(" ")).filter((w) => words.has(w));
  const place = fitTokens(profile.locations.join(" ")).filter((w) => words.has(w));
  if (industry.length === 0) return "";
  const parts = [`mentions "${industry.slice(0, 3).join(" ")}"`];
  if (place.length) parts.push(`mentions ${place.slice(0, 2).join(" ")}`);
  return `Company site ${parts.join("; ")}.`;
}

async function withinMs<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(0, ms));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function ownEmail(email: string, host: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return domain === host || domain.endsWith(`.${host}`);
}

export async function searchCompanyLeads(ports: CompanySearchPorts, input: CompanySearchInput): Promise<CompanySearchResult> {
  const queries = buildCompanyQueries(input.profile);
  if (queries.length === 0) return { leads: [], droppedNoContact: 0, droppedNoFit: 0, duplicates: 0 };

  const hitSets = await Promise.all(queries.map((q) => ports.provider.search(q, RESULTS_PER_QUERY).catch((): SearchHit[] => [])));
  const known = await ports.knownHosts();
  const excludeHosts = [
    input.ownHost ?? "",
    ...(input.profile.exclude ?? []).map((e) => e.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "")),
  ].filter(Boolean);
  const sites = pickCompanySites(hitSets.flat(), { excludeHosts, max: 1000 });
  const duplicates = sites.filter((c) => known.has(c.host)).length;
  const candidates = sites.filter((c) => !known.has(c.host)).slice(0, CANDIDATE_CAP);

  const deadline = Date.now() + (input.budgetMs ?? COMPANY_BUDGET_MS);
  const maxLeads = input.maxLeads ?? 10;
  let droppedNoContact = 0;
  let droppedNoFit = 0;

  const drafts = await pool(candidates, input.concurrency ?? COMPANY_CONCURRENCY, async (c: CompanyCandidate): Promise<CompanyLeadDraft | null> => {
    if (Date.now() >= deadline) return null;
    const enrichment = await withinMs(ports.enrich(c.website), deadline - Date.now());
    if (!enrichment || enrichment.status !== "ok") return null;

    const fitReason = describeCompanyFit(input.profile, `${c.title} ${c.snippet} ${enrichment.description ?? ""}`);
    if (!fitReason) {
      droppedNoFit += 1;
      return null;
    }
    const email = pickOutreachEmail(enrichment.emails);
    const sourceUrl = enrichment.contactUrl ?? c.website;
    if (!qualifyLead({ email, whatsapp: enrichment.whatsapp, sourceUrl, fitReason }).qualified) {
      droppedNoContact += 1;
      return null;
    }
    return {
      name: c.name,
      website: c.website,
      host: c.host,
      email,
      emailQuality: email ? (ownEmail(email, c.host) ? "source_found" : "domain_found") : null,
      whatsapp: enrichment.whatsapp,
      contactUrl: enrichment.contactUrl,
      description: enrichment.description,
      sourceUrl,
      fitReason,
    };
  });

  const leads = drafts.filter((d): d is CompanyLeadDraft => d !== null).slice(0, maxLeads);
  return { leads, droppedNoContact, droppedNoFit, duplicates };
}
