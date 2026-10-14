/**
 * Rule-based parsing of one web-search result into a LinkedIn person profile.
 *
 * Tavily returns LinkedIn profile pages with a structured `content` block
 * ("Headline: ... | Current role: ... | Location: ... | Description: ...") and a
 * title like "Jane Doe - B2B SaaS Marketing VP". Everything here is a plain
 * string rule so a result is either understood or rejected; nothing is guessed.
 * The company is the one field that is often missing, and only the caller can
 * ask the LLM to fill it (see leadSearchCore.ts).
 */

import { isGeographyTerm, locationTerms } from "./leadGeography.ts";

export type LinkedInSearchResult = { title: string; url: string; content: string };

/** Optional search context: the location the query asked for. */
export type ParseContext = { queryLocation?: string };

export type ParsedLinkedInProfile = {
  name: string;
  headline: string;
  /** Current role (job title), as the profile states it. */
  title: string;
  seniority: string;
  location: string;
  followers: number | null;
  /** Company, or null when no rule could say it without guessing. */
  company: string | null;
  /** Canonical https://www.linkedin.com/in/<slug> URL. */
  sourceUrl: string;
  description: string;
};

const MAX_NAME_LENGTH = 60;
const MAX_COMPANY_LENGTH = 60;
const MAX_COMPANY_WORDS = 5;
const MAX_DESCRIPTION_LENGTH = 600;

/** Words that end a company phrase or make it a placeholder, never a company. */
const NOT_A_COMPANY = /^(linkedin|freelance|freelancer|self[- ]employed|independent|stealth|stealth mode|retired|student|none|n\/a|various|current|open to work|available|unemployed|confidential|personal|me|myself|consultant|consulting|contractor|entrepreneur|founder|owner|business owner)$/i;

/**
 * Common English nouns and adjectives that often follow "at" in a headline
 * ("grow at scale", "SaaS at heart") without naming an employer.
 */
const COMMON_WORDS = new Set([
  "all", "any", "best", "big", "business", "centre", "center", "core", "daily", "dark", "end", "essence",
  "everyone", "first", "growth", "heart", "home", "large", "last", "launch", "life", "least", "mind", "more",
  "most", "night", "people", "play", "present", "rest", "risk", "scale", "sea", "small", "speed", "time",
  "work", "war", "peace", "possible", "once", "will",
]);

/** Words that show a listing or article title rather than a person's name. */
const NOT_A_NAME_WORD = new Set([
  "best", "top", "agency", "agencies", "directory", "companies", "company", "leaders", "jobs", "hiring",
  "guide", "list", "tips", "services", "software", "tools", "review", "reviews",
]);

/** Role keywords for the "Role, Company" rule. Deliberately broad, rule-only. */
const ROLE_WORD = /\b(founder|co-?founder|ceo|cto|cmo|coo|cfo|cpo|vp|svp|evp|president|director|head|chief|manager|lead|senior|principal|engineer|developer|designer|marketing|sales|growth|partner|owner|consultant|specialist|officer|analyst|architect|producer|editor|writer|advisor|strategist|recruiter|coach|product|operations|account|executive)\b/i;

const TRAILING_STOPWORDS = new Set(["and", "&", "the", "of", "with", "for", "in", "at", "a", "an", "to", "by", "on", "-", "|", "/", "\u00b7"]);

/** Accept only canonical person-profile URLs on any linkedin.com host. */
export function canonicalProfileUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  // Explicit rejects first, so the reason is obvious in code review.
  if (/^\/(company|jobs|pulse|posts|school|showcase)(\/|$)/i.test(url.pathname)) return null;
  const match = url.pathname.match(/^\/in\/([^/]+)(\/|$)/i);
  if (!match) return null;
  const slug = match[1].toLowerCase();
  if (!/^[a-z0-9%\-_.]+$/.test(slug)) return null;
  return `https://www.linkedin.com/in/${slug}`;
}

/** Strip emoji and invisible joiners that LinkedIn titles often carry. */
function stripDecoration(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[\u200d\ufe0f\u200b]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name is the title before the first " - " / " | " separator, minus credentials after a comma. */
export function extractName(resultTitle: string): string | null {
  const cleaned = stripDecoration(resultTitle).replace(/\s*[|-]\s*LinkedIn\s*$/i, "");
  const head = cleaned.split(/\s+[-|\u2013\u2014]\s+/)[0] ?? "";
  const name = head.split(",")[0].replace(/\s+/g, " ").trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  if (/linkedin|\d/i.test(name)) return null;
  const words = name.split(" ");
  if (words.length > 5) return null;
  if (words.some((w) => NOT_A_NAME_WORD.has(w.toLowerCase()))) return null;
  // Letters (any script), spaces, and the punctuation real names use.
  if (!/^[\p{L}][\p{L}\p{M} .'\u2019-]*$/u.test(name)) return null;
  return name;
}

/** Labelled fields from the "Label: value | Label: value" block. */
function parseFields(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const text = stripDecoration(content.replace(/^#+\s*/, ""));
  const segments = text.split(/\s+\|\s+/);
  for (let i = 0; i < segments.length; i++) {
    const m = segments[i].match(/^([A-Za-z][A-Za-z ]{1,30}?)\s*:\s*(.*)$/);
    if (!m) continue;
    const label = m[1].trim().toLowerCase();
    if (label === "description") {
      // Descriptions can themselves contain " | ", so keep the rest of the block.
      fields.description = segments.slice(i).join(" | ").replace(/^description\s*:\s*/i, "").slice(0, MAX_DESCRIPTION_LENGTH);
      break;
    }
    if (!(label in fields) && m[2].trim()) fields[label] = m[2].trim();
  }
  return fields;
}

function parseFollowers(content: string): number | null {
  const m = content.match(/([\d][\d.,]*)\s*([KkMm])?\s+followers/i);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const mult = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  return Math.round(base * mult);
}

/** Cut a candidate company phrase and trim it; null when it is not a plausible company name. */
export function cleanCompany(raw: string): string | null {
  let text = stripDecoration(raw);
  // Anything after a separator or bracket is a second thought, not the company.
  text = text.split(/\s[|\u00b7\u2022\u2014\u2013]\s|\s-\s|\(|,|\s@\s/)[0].trim();
  if (/\s(and|&)\s/i.test(text)) return null; // "Acme and Beta" is ambiguous: unsure, so null
  const words = text.split(" ").filter(Boolean);
  while (words.length && TRAILING_STOPWORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  text = words.join(" ");
  if (!text || text.length < 2 || text.length > MAX_COMPANY_LENGTH) return null;
  if (words.length > MAX_COMPANY_WORDS) return null;
  if (NOT_A_COMPANY.test(text)) return null;
  if (isGeographyTerm(text)) return null;
  if (/https?:|@|\d{4,}/i.test(text)) return null;
  return text;
}

type CompanyContext = { locations: Set<string> };

/** Drop a candidate that is one of the profile's or the query's own location words. */
function notALocation(company: string | null, ctx: CompanyContext): string | null {
  if (!company) return null;
  return ctx.locations.has(company.toLowerCase()) ? null : company;
}

/** "... at X" or "... @ X" anywhere in the phrase. X must look like a name: capitalised or numeric, not a common word. */
function companyFromAt(text: string, ctx: CompanyContext): string | null {
  const m = text.match(/(?:^|\s)(?:at|@)\s+(.+)$/i);
  if (!m) return null;
  const raw = m[1].trim();
  if (!/^[A-Z0-9]/.test(raw)) return null;
  const company = cleanCompany(raw);
  if (!company || COMMON_WORDS.has(company.toLowerCase())) return null;
  return notALocation(company, ctx);
}

/** "Role, X" or "Role | X" where Role carries a role keyword and X is the rest. */
function companyFromRolePhrase(text: string, ctx: CompanyContext): string | null {
  const parts = text.split(/\s*[,|]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  if (!ROLE_WORD.test(parts[0])) return null;
  return notALocation(cleanCompany(parts[1]), ctx);
}

/**
 * Company by ordered rules. Each rule that fires must agree; if two rules
 * name different companies, the answer is unsure, so null.
 */
export function inferCompany(input: {
  resultTitle: string;
  headline: string;
  currentRole: string;
  /** The profile's own "Location:" text. */
  location?: string;
  /** The location the search asked for. */
  queryLocation?: string;
}): string | null {
  const titleRest = stripDecoration(input.resultTitle).split(/\s+[-|\u2013\u2014]\s+/).slice(1).join(" - ");
  const ctx: CompanyContext = {
    locations: new Set([...locationTerms(input.location), ...locationTerms(input.queryLocation)]),
  };
  const candidates = [
    companyFromAt(titleRest, ctx),
    companyFromAt(input.headline, ctx),
    companyFromAt(input.currentRole, ctx),
    companyFromRolePhrase(input.headline, ctx),
    companyFromRolePhrase(titleRest, ctx),
  ].filter((c): c is string => c !== null);
  if (candidates.length === 0) return null;
  const first = candidates[0].toLowerCase();
  return candidates.every((c) => c.toLowerCase() === first) ? candidates[0] : null;
}

/**
 * Parse one search result. Returns null for anything that is not a LinkedIn
 * person profile (company pages, jobs, posts, articles, directories).
 */
export function parseLinkedInResult(result: LinkedInSearchResult, context: ParseContext = {}): ParsedLinkedInProfile | null {
  const sourceUrl = canonicalProfileUrl(result.url);
  if (!sourceUrl) return null;

  const resultTitle = stripDecoration(result.title ?? "");
  const name = extractName(resultTitle);
  if (!name) return null;

  const content = typeof result.content === "string" ? result.content : "";
  const fields = parseFields(content);
  const headline = fields.headline ?? "";
  const currentRole = fields["current role"] ?? "";
  const seniority = fields.seniority ?? "";
  const location = fields.location ?? "";
  const description = fields.description ?? "";

  return {
    name,
    headline,
    title: currentRole,
    seniority,
    location,
    followers: parseFollowers(content),
    company: inferCompany({ resultTitle, headline, currentRole, location, queryLocation: context.queryLocation }),
    sourceUrl,
    description,
  };
}
