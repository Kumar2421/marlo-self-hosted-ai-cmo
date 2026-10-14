import { cleanCompany, parseLinkedInResult, type LinkedInSearchResult, type ParsedLinkedInProfile } from "./profileParse.ts";
import { dedupeProfiles, type FitTarget } from "./leadFit.ts";

/** Tavily gives 20 results per query at most; the Custom Search API caps at 10. */
export const RESULTS_PER_QUERY = 20;
export const GOOGLE_RESULTS_PER_QUERY = 10;

/** Company fill-in: one small LLM call per chunk, sequential. */
export const GAP_FILL_MAX_PROFILES_PER_CALL = 25;
/** Hard cap on the estimated prompt tokens of one call (chars / 4). */
export const GAP_FILL_PROMPT_TOKEN_CAP = 2500;
const GAP_FILL_MAX_OUTPUT_TOKENS_ESTIMATE = 400;
/** Groq free tier is 8000 tokens per minute; one call must stay well under it. */
export const GAP_FILL_SINGLE_CALL_TOKEN_CAP = 3000;

const NAME_MAX = 60;
const HEADLINE_MAX = 120;
const TITLE_MAX = 80;

/** Minimal driver shape, structurally the same as LlmDriver (no import needed). */
export type CompletionDriver = (req: {
  apiKey: string;
  model: string;
  system: string;
  messages: { role: "user"; content: string }[];
  stream: false;
  baseUrl?: string;
}) => Promise<{ text?: string }>;

/**
 * Rough prompt size: ASCII at about 4 characters per token, but every other
 * character (CJK, accents, emoji) at about 1 token, so non-Latin text cannot
 * slip past the budget the way a flat chars/4 count let it.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let wide = 0;
  for (const ch of text) {
    if (ch.codePointAt(0)! <= 0x7f) ascii += 1;
    else wide += 1;
  }
  return Math.ceil(ascii / 4) + wide;
}

const FILLER = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The productive LinkedIn-targeted queries. Earlier versions also ran generic
 * "email contact" / "directory" / "contact us" queries that returned almost
 * no person profiles (2, 0 and 0 of 20 in the measured run), so they are gone.
 */
export function buildLinkedInQueries(target: FitTarget): string[] {
  const role = FILLER(target.role);
  const industry = FILLER(target.companyOrIndustry);
  const location = FILLER(target.location);
  const roleTerm = role ? `"${role}"` : "";
  const queries = [
    FILLER(`${roleTerm} ${industry} ${location} site:linkedin.com/in`),
    FILLER(`${roleTerm} ${industry} linkedin profile`),
  ];
  if (location) queries.push(FILLER(`${roleTerm} ${industry} linkedin`));
  return queries.filter((q) => q.length > 0 && q.replace(/["\s]/g, "").length > 0);
}

export type CollectStats = { queriesRun: number; resultsSeen: number; profilesParsed: number };

export type SearchPorts = {
  tavily: (query: string) => Promise<LinkedInSearchResult[]>;
  /** Optional second source, used for the first query only. */
  google?: (query: string) => Promise<LinkedInSearchResult[]>;
};

/**
 * Run the queries (in parallel), keep only LinkedIn person profiles, and
 * dedupe by profile URL. A failing source contributes nothing; it never throws.
 */
export async function collectProfiles(
  queries: string[],
  ports: SearchPorts,
  context: { queryLocation?: string } = {}
): Promise<{ profiles: ParsedLinkedInProfile[]; stats: CollectStats }> {
  const tavilySets = await Promise.all(queries.map((q) => ports.tavily(q).catch(() => [] as LinkedInSearchResult[])));
  const googleSets = ports.google && queries.length > 0
    ? await ports.google(queries[0]).catch(() => [] as LinkedInSearchResult[])
    : [];

  const results = [...tavilySets.flat(), ...googleSets];
  const parsed: ParsedLinkedInProfile[] = [];
  for (const r of results) {
    const profile = parseLinkedInResult(r, { queryLocation: context.queryLocation });
    if (profile) parsed.push(profile);
  }
  return {
    profiles: dedupeProfiles(parsed),
    stats: { queriesRun: queries.length, resultsSeen: results.length, profilesParsed: parsed.length },
  };
}

const GAP_FILL_SYSTEM = `You fill in the employer of people from short profile lines.
Each input line is: id|name|headline|title. For each id, give the company that the
line itself names (for example "... at Acme" means Acme). If the line does not clearly
name the company, use null. Never guess and never use outside knowledge.
Respond with ONLY a JSON array, no prose, no code fences, in exactly this shape:
[{"id": 0, "company": "Acme"}, {"id": 1, "company": null}]`;

function clip(text: string, max: number): string {
  const flat = FILLER(text).replace(/\|/g, "/");
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

function gapLine(index: number, p: ParsedLinkedInProfile): string {
  return `${index}|${clip(p.name, NAME_MAX)}|${clip(p.headline, HEADLINE_MAX)}|${clip(p.title, TITLE_MAX)}`;
}

/**
 * Split the profiles that lack a company into chunks whose estimated prompt
 * stays under GAP_FILL_PROMPT_TOKEN_CAP and whose size stays under
 * GAP_FILL_MAX_PROFILES_PER_CALL. Each entry is the profile's index in `profiles`.
 */
export function buildGapFillChunks(profiles: ParsedLinkedInProfile[]): number[][] {
  const systemTokens = estimateTokens(GAP_FILL_SYSTEM);
  const chunks: number[][] = [];
  let current: number[] = [];
  let currentTokens = systemTokens + 40; // header and framing
  profiles.forEach((p, index) => {
    if (p.company) return;
    const lineTokens = estimateTokens(gapLine(index, p)) + 1;
    const full = current.length >= GAP_FILL_MAX_PROFILES_PER_CALL || currentTokens + lineTokens > GAP_FILL_PROMPT_TOKEN_CAP;
    if (full && current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = systemTokens + 40;
    }
    current.push(index);
    currentTokens += lineTokens;
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Strict JSON array of {id, company}; anything else yields no answers for that chunk. */
function parseGapAnswer(raw: string, allowed: Set<number>): Map<number, string> {
  const out = new Map<number, string>();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "number" || !allowed.has(o.id)) continue;
    if (typeof o.company !== "string") continue;
    // Same cleaning as the rule path: no placeholders, no geography, no trailing junk.
    const company = cleanCompany(FILLER(o.company).slice(0, 80));
    if (company) out.set(o.id, company);
  }
  return out;
}

/**
 * A company is accepted only when the profile's own text names it as a whole
 * word, case-insensitively. "Acme" does not match inside "Acmeland" or "Acme1".
 */
function appearsInProfile(company: string, p: ParsedLinkedInProfile): boolean {
  if (company.length < 2) return false;
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu");
  return word.test(`${p.headline} ${p.title} ${p.description}`);
}

export type GapFillOutcome = {
  /** Profile index -> company, for the profiles the model answered. */
  companies: Map<number, string>;
  /** One-line, secret-free reason when fill-in stopped early; null when all chunks ran. */
  error: string | null;
  calls: number;
  promptTokens: number;
};

/**
 * Ask the LLM only for the missing companies. Sequential chunks; on the first
 * failure (rate limit, too large, timeout, bad JSON) it stops and keeps what
 * the earlier chunks gave. It never throws.
 */
export async function fillMissingCompanies(
  driver: CompletionDriver,
  profiles: ParsedLinkedInProfile[],
  opts: { apiKey: string; model: string; baseUrl?: string }
): Promise<GapFillOutcome> {
  const outcome: GapFillOutcome = { companies: new Map(), error: null, calls: 0, promptTokens: 0 };
  const chunks = buildGapFillChunks(profiles);
  for (const chunk of chunks) {
    const prompt = `Profiles:\n${chunk.map((i) => gapLine(i, profiles[i])).join("\n")}`;
    const promptTokens = estimateTokens(GAP_FILL_SYSTEM) + estimateTokens(prompt);
    if (promptTokens + GAP_FILL_MAX_OUTPUT_TOKENS_ESTIMATE > GAP_FILL_SINGLE_CALL_TOKEN_CAP) {
      outcome.error = "company fill skipped: prompt over token budget";
      break;
    }
    try {
      outcome.calls += 1;
      outcome.promptTokens += promptTokens;
      const result = await driver({
        apiKey: opts.apiKey,
        model: opts.model,
        system: GAP_FILL_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        baseUrl: opts.baseUrl,
      });
      const answers = parseGapAnswer(result.text ?? "", new Set(chunk));
      for (const [index, company] of answers) {
        if (appearsInProfile(company, profiles[index])) outcome.companies.set(index, company);
      }
    } catch (err) {
      outcome.error = describeFailure(err, opts.apiKey);
      break;
    }
  }
  return outcome;
}

/** Short reason for a log line: no keys, no request bodies, no long messages. */
export function describeFailure(err: unknown, secret: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const status = raw.match(/\b([45]\d{2})\b/);
  const safe = (secret ? raw.split(secret).join("[redacted]") : raw).replace(/\s+/g, " ").slice(0, 80);
  return status ? `HTTP ${status[1]}: ${safe}` : safe;
}
