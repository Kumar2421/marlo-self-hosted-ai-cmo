import { deriveLeadTarget } from "./leadTarget.ts";
import type { OfferModel } from "../offer/offerModel.ts";

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

/**
 * Who this project wants as customers. Confirmed once by the user, then used
 * by every lead search (manual and the daily auto-leads), so leads start from
 * a definition the user agreed to instead of a guess.
 */
export type LeadProfile = {
  version: 1;
  /** Job titles of the people to reach. */
  roles: string[];
  /** The kinds of companies they work at. */
  industries: string[];
  sizes: CompanySize[];
  /** Empty means anywhere. */
  locations: string[];
  /** The problem the product solves; guides relevance and later the outreach. */
  problem: string;
  /** Companies, domains or words to never return (competitors are added automatically). */
  exclude: string[];
  /** Whether the product relates to websites/marketing, so a website check of each lead is useful. */
  webRelated: boolean;
  confirmedAt: string | null;
};

export const LIMITS = { roles: 5, industries: 5, locations: 3, exclude: 20, itemLength: 60, problemLength: 280 } as const;

export function emptyProfile(): LeadProfile {
  return { version: 1, roles: [], industries: [], sizes: [], locations: [], problem: "", exclude: [], webRelated: false, confirmedAt: null };
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim().slice(0, LIMITS.itemLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Sanitize anything coming from the client or storage into a valid profile. Never throws. */
export function normalizeProfile(input: unknown): LeadProfile {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const sizes = Array.isArray(o.sizes) ? COMPANY_SIZES.filter((s) => (o.sizes as unknown[]).includes(s)) : [];
  return {
    version: 1,
    roles: cleanList(o.roles, LIMITS.roles),
    industries: cleanList(o.industries, LIMITS.industries),
    sizes,
    locations: cleanList(o.locations, LIMITS.locations),
    problem: typeof o.problem === "string" ? o.problem.replace(/\s+/g, " ").trim().slice(0, LIMITS.problemLength) : "",
    exclude: cleanList(o.exclude, LIMITS.exclude),
    webRelated: o.webRelated === true,
    confirmedAt: typeof o.confirmedAt === "string" && o.confirmedAt ? o.confirmedAt : null,
  };
}

/** What still blocks confirming; empty means ready. */
export function profileProblems(profile: LeadProfile): string[] {
  // A buyer may be a person with a job title, or a kind of business or customer with no title at all
  // (a clinic, a shop, a freelancer's client). Either is enough to search on.
  if (profile.roles.length === 0 && profile.industries.length === 0) {
    return ["Say who you want to reach: a job title, or a kind of company or customer."];
  }
  return [];
}

export function isConfirmed(profile: LeadProfile | null | undefined): profile is LeadProfile {
  return Boolean(profile && profile.confirmedAt && profileProblems(profile).length === 0);
}

const WEB_WORDS = /\b(websites?|web ?sites?|seo|search engine|marketing|ecommerce|e-commerce|landing pages?|conversion|analytics|content|blogs?|web ?design|web ?development|hosting|domains?)\b/i;

/**
 * A starting profile for the user to review, from the project's own docs.
 * It is a draft: nothing is confirmed until the user does so.
 */
export function suggestProfile(input: {
  marketingStrategy: string | null | undefined;
  productInfo: string | null | undefined;
  category: string | null | undefined;
  name: string;
  /** Competitor domains already found for the project; they must never come back as leads. */
  competitors: string[];
  /** What Marlo read from the site itself. When it says who buys, it leads; the document rules fill the gaps. */
  offer?: OfferModel | null;
}): LeadProfile {
  const offer = input.offer && (input.offer.whoPays || input.offer.roles.length > 0 || input.offer.industries.length > 0) ? input.offer : null;
  const target = deriveLeadTarget({
    marketingStrategy: input.marketingStrategy,
    productInfo: input.productInfo,
    category: input.category,
    name: input.name,
  });
  const problem = firstProblemSentence(input.productInfo) ?? firstProblemSentence(input.marketingStrategy) ?? "";
  const webText = `${input.category ?? ""} ${input.productInfo ?? ""}`;
  if (offer) {
    return normalizeProfile({
      roles: offer.roles.length > 0 ? offer.roles : target.roles,
      // The site's own words for who it serves. "Who pays" stands in when it names no kind of company.
      industries: offer.industries.length > 0 ? offer.industries : offer.whoPays ? [offer.whoPays] : target.industry ? [target.industry] : [],
      locations: offer.locations.length > 0 ? offer.locations : target.location ? [target.location] : [],
      problem: offer.problem || problem,
      exclude: input.competitors,
      webRelated: offer.webRelated || WEB_WORDS.test(webText),
    });
  }
  return normalizeProfile({
    roles: target.roles,
    // With no ICP, the category is a weak but honest starting point.
    industries: target.industry ? [target.industry] : [],
    locations: target.location ? [target.location] : [],
    problem,
    exclude: input.competitors,
    webRelated: WEB_WORDS.test(webText),
  });
}

function firstProblemSentence(doc: string | null | undefined): string | null {
  if (!doc) return null;
  const sentences = doc.replace(/[#*_`>-]+/g, " ").split(/(?<=[.!?])\s+/);
  const hit = sentences.find((s) => /\b(problem|pain|struggle|challenge|helps?|so that|without|instead of)\b/i.test(s) && s.length >= 30 && s.length <= LIMITS.problemLength);
  return hit ? hit.replace(/\s+/g, " ").trim() : null;
}

export type LeadSearchTarget = { role: string; companyOrIndustry: string; location: string };

function dayOfYear(date: Date): number {
  return Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
}

/**
 * Today's search for the daily run: one role + industry + location from the
 * profile, rotating across every combination so repeated days reach
 * different people instead of re-finding the same ones.
 */
export function pickSearch(profile: LeadProfile, date: Date): LeadSearchTarget {
  const roles = profile.roles.length > 0 ? profile.roles : [""];
  const industries = profile.industries.length > 0 ? profile.industries : [""];
  const locations = profile.locations.length > 0 ? profile.locations : [""];
  const total = roles.length * industries.length * locations.length;
  const index = dayOfYear(date) % total;
  return {
    role: roles[index % roles.length],
    companyOrIndustry: industries[Math.floor(index / roles.length) % industries.length],
    location: locations[Math.floor(index / (roles.length * industries.length)) % locations.length],
  };
}

type LeadLike = { name: string; company: string; sourceUrl: string | null; email?: string | null };

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Drop leads whose company, name, email domain or source page matches anything the user excluded. */
export function applyExclusions<T extends LeadLike>(leads: T[], exclude: readonly string[]): T[] {
  const needles = exclude.map((e) => e.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "")).filter(Boolean);
  if (needles.length === 0) return leads;
  return leads.filter((lead) => {
    const haystacks = [lead.company, lead.name, hostOf(lead.sourceUrl), lead.email?.split("@")[1] ?? ""].map((h) => h.toLowerCase());
    return !needles.some((needle) => haystacks.some((h) => h && h.includes(needle)));
  });
}

/** One sentence describing the target, for the extraction prompt and the UI summary. */
export function describeProfile(profile: LeadProfile): string {
  const parts = [
    profile.roles.length ? `people who work as ${profile.roles.join(" / ")}` : "",
    profile.industries.length ? `at ${profile.industries.join(" / ")} companies` : "",
    profile.sizes.length ? `with ${profile.sizes.join(" or ")} employees` : "",
    profile.locations.length ? `in ${profile.locations.join(" / ")}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}
