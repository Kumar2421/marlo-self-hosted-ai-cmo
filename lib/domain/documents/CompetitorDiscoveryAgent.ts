import type { LlmDriver } from "@/lib/llm";
import { buildWebSearchTool, tavilySearchRaw } from "@/lib/domain/shared/webSearchTool";
import { buildDiscoveryQueries, extractCompetitorCandidates, isDeniedDomain } from "./competitorCandidates";

export type CompetitorDiscoveryRequest = {
  projectName: string;
  url: string;
  bodyText: string;
  metaTitle: string;
  metaDescription: string;
  /** What the product does (the project description). Drives the search queries instead of the bare name. */
  description?: string;
  productInfo?: string;
  marketingStrategy?: string;
  /** Optional: discovery works from web search alone; a model only refines the result. */
  model?: string;
  /** When set (and the active provider supports tools — see
   * providerSupportsTools), the model searches the live web to find real
   * competitors. When absent, it falls back to naming known competitors from
   * its own training knowledge, grounded only in the crawled site context —
   * every name it gives still gets verified by a real fetch before being
   * saved, so a wrong guess just gets dropped rather than saved as fact. */
  tavilyApiKey?: string;
  /** Whether this provider's driver implements tool-calling. Search results no
   * longer depend on it (Tavily is queried directly), it only decides whether
   * the model is also handed the web_search tool. */
  llmSupportsTools?: boolean;
};

export type DiscoveredCandidate = { domain: string; reason: string };

const MAX_CANDIDATES = 12;

function ownHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Small local models routinely wrap JSON in ```json fences or add a
 * sentence before/after it — same class of quirk as the angle-bracket
 * templating bug found earlier this session. Extract the first [...] block
 * rather than trusting the whole response to be valid JSON on its own. */
function parseCandidates(raw: string, ownDomain: string): DiscoveredCandidate[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const out: DiscoveredCandidate[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rawDomain = (item as Record<string, unknown>).domain;
    const rawReason = (item as Record<string, unknown>).reason;
    if (typeof rawDomain !== "string") continue;

    const domain = rawDomain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    if (!domain || !domain.includes(".") || domain === ownDomain || seen.has(domain) || isDeniedDomain(domain)) continue;

    seen.add(domain);
    out.push({ domain, reason: typeof rawReason === "string" ? rawReason : "" });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * Proposes real-world competitors for a project — the LLM half of
 * "automatic" competitor discovery (see refimages/Screenshot 2026-08-31
 * 125026.png, which shows the Competitors section pre-populated with no
 * manual-entry UI visible). Every domain this returns is a *candidate* only
 * — the caller must still verify each one resolves (fetchCompetitorSnippet)
 * before saving it, since neither mode here is search-grounded enough on its
 * own to trust blindly, especially the no-Tavily fallback.
 */
export class CompetitorDiscoveryAgent {
  constructor(private driver: LlmDriver | null, private apiKey: string, private baseUrl?: string) {}

  /**
   * Tavily is the primary source: real "alternatives / competitors / vs"
   * searches, turned into candidates without any model (see
   * competitorCandidates.ts). The LLM is an optional enhancer that adds
   * context-aware picks and better wording; if it fails (retired model id,
   * rate limit, bad key) the search-derived candidates are still returned
   * instead of failing the whole feature.
   */
  async discover(req: CompetitorDiscoveryRequest): Promise<{ candidates: DiscoveredCandidate[]; usedWebSearch: boolean; llmUsed: boolean }> {
    const tavilyKey = req.tavilyApiKey;
    const ownDomain = ownHost(req.url);

    let fromSearch: DiscoveredCandidate[] = [];
    if (tavilyKey) {
      const queries = buildDiscoveryQueries(req.projectName, req.metaTitle, req.description || req.metaDescription);
      const resultSets = await Promise.all(queries.map((q) => tavilySearchRaw(tavilyKey, q, 10).catch(() => [])));
      fromSearch = extractCompetitorCandidates(resultSets, ownDomain);
    }

    // No usable model: the search-derived candidates stand on their own.
    if (!this.driver || !req.model) {
      if (fromSearch.length === 0) {
        throw new Error(
          tavilyKey
            ? "Web search found no confident competitors for this product yet."
            : "Connect a Tavily key (or a model) in Settings to discover competitors.",
        );
      }
      return { candidates: fromSearch, usedWebSearch: true, llmUsed: false };
    }

    try {
      const candidates = await this.askModel(req, fromSearch, ownDomain);
      return { candidates: mergeCandidates(candidates, fromSearch), usedWebSearch: !!tavilyKey, llmUsed: true };
    } catch (err) {
      if (fromSearch.length === 0) throw err;
      return { candidates: fromSearch, usedWebSearch: true, llmUsed: false };
    }
  }

  private async askModel(req: CompetitorDiscoveryRequest, fromSearch: DiscoveredCandidate[], ownDomain: string): Promise<DiscoveredCandidate[]> {
    const hasWebSearch = !!req.tavilyApiKey && req.llmSupportsTools !== false;

    const system = `You are a senior competitive-intelligence analyst. Given a product's site data,
name up to ${MAX_CANDIDATES} real, currently-operating companies that genuinely compete with it —
not generic platforms unless they have a feature that directly overlaps.

${
  hasWebSearch
    ? `Use the web_search tool (queries like "<category> alternatives to <product>", "best <category> tools", "<product> vs") to find real competitors — don't rely on memory alone when you can confirm one.`
    : `You don't have web access this time. Name only companies you're confident actually exist from your own knowledge — every domain you give will be independently verified by fetching its website before it's shown to anyone, so a wrong or outdated guess just gets silently dropped. Don't pad the list to reach ${MAX_CANDIDATES} if you're not confident.`
}

Respond with ONLY a JSON array, no markdown code fences, no prose before or
after it, in exactly this shape:
[{"domain": "example.com", "reason": "one short sentence"}]`;

    const searchHint = fromSearch.length
      ? `\nCandidates already found by real web searches (confirm, drop any that are not true competitors, and add any you are confident are missing):\n${fromSearch.map((c) => `- ${c.domain}`).join("\n")}\n`
      : "";

    const prompt = `Product: ${req.projectName} (${req.url})
What it does: ${req.description || req.metaDescription || "(unknown)"}
Only name companies that sell the same kind of product to the same kind of customer; ignore businesses in unrelated industries even if a name or word matches.
Meta title: ${req.metaTitle || "(none found)"}
Meta description: ${req.metaDescription || "(none found)"}
Crawled page text (truncated): """${req.bodyText.slice(0, 2000) || "(none extracted)"}"""
${req.productInfo ? `\nProduct Information document:\n"""\n${req.productInfo.slice(0, 1500)}\n"""\n` : ""}${
      req.marketingStrategy ? `\nMarketing Strategy document (ICP, positioning):\n"""\n${req.marketingStrategy.slice(0, 1500)}\n"""\n` : ""
    }${searchHint}`;

    const result = await this.driver!({
      apiKey: this.apiKey,
      model: req.model!,
      system,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      baseUrl: this.baseUrl,
      tools: hasWebSearch ? [buildWebSearchTool(req.tavilyApiKey!)] : undefined,
    });

    return parseCandidates(result.text ?? "", ownDomain);
  }
}

/** Model picks first (they carry reasons written for this product), then search-derived ones it did not repeat. */
function mergeCandidates(primary: DiscoveredCandidate[], extra: DiscoveredCandidate[]): DiscoveredCandidate[] {
  const seen = new Set<string>();
  const out: DiscoveredCandidate[] = [];
  for (const candidate of [...primary, ...extra]) {
    if (seen.has(candidate.domain)) continue;
    seen.add(candidate.domain);
    out.push(candidate);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}
