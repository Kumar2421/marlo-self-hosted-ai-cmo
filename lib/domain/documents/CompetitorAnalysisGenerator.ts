import { GROUNDING_RULES } from "./grounding.ts";
import * as cheerio from "cheerio";
import type { LlmDriver, CompletionResult } from "@/lib/llm";
import { buildWebSearchTool } from "../shared/webSearchTool.ts";
import { safeFetch, SafeFetchError } from "../net/safeFetch.ts";

export type CompetitorSnippet = {
  url: string;
  title: string;
  description: string;
  /** Real Google Knowledge Graph entity description, if the company matched
   * one — an authoritative signal beyond just the crawled title/description. */
  kgDescription?: string;
};

export type CompetitorAnalysisRequest = {
  projectName: string;
  url: string;
  bodyText: string;
  metaTitle: string;
  metaDescription: string;
  competitors: CompetitorSnippet[];
  model: string;
  /** When set, the model gets a real web_search tool for this generation —
   * used to fill in gaps the crawled title/description can't answer (current
   * pricing, recent positioning, news). Omit to fall back to crawl-only. */
  tavilyApiKey?: string;
};

const FETCH_TIMEOUT_MS = 6000;

/** Lightweight crawl of a competitor's homepage — title + meta description
 * only, not a full SEOAgent audit (that would be 5-10x the crawl cost for
 * data this document doesn't need). Real fetch, not invented: if it fails,
 * the competitor is still listed with an honest "(couldn't fetch)" note
 * rather than the LLM guessing what the company does from its domain name. */
export async function fetchCompetitorSnippet(url: string): Promise<CompetitorSnippet> {
  try {
    const res = await safeFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { "User-Agent": "OkaraAlternative/1.0" },
      allowedContentTypes: ["text/html", "application/xhtml+xml"],
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    const $ = cheerio.load(res.bodyText);
    return {
      url,
      title: $("title").text().trim() || "(no title found)",
      description: $("meta[name='description']").attr("content")?.trim() || "(no meta description found)",
    };
  } catch (e) {
    // Only the generic guarded-fetch text (or an HTTP status) reaches the document; detail stays in logs.
    const detail = e instanceof SafeFetchError ? e.message : e instanceof Error && e.message.startsWith("HTTP ") ? e.message : "The site could not be reached.";
    if (e instanceof SafeFetchError) console.warn("competitor.snippet.failed", e.code);
    return { url, title: "(couldn't fetch)", description: `Crawl failed: ${detail}` };
  }
}

/**
 * Mirrors okara.ai's real "Competitor Analysis" document. No public
 * reference screenshot existed for this one (see session research), so the
 * structure below follows standard competitive-analysis practice: landscape
 * table, differentiation, gaps/opportunities. Grounded in real (if thin)
 * crawled data for each competitor — never invents what a competitor does.
 */
export class CompetitorAnalysisGenerator {
  private driver: LlmDriver;
  private apiKey: string;
  private baseUrl?: string;
  constructor(driver: LlmDriver, apiKey: string, baseUrl?: string) {
    this.driver = driver;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async generate(req: CompetitorAnalysisRequest): Promise<CompletionResult> {
    if (req.competitors.length === 0) {
      throw new Error("No competitors added yet — add at least one in the Context panel first.");
    }

    const hasWebSearch = !!req.tavilyApiKey;

    const system = `You are a senior B2B marketing strategist writing an internal "Competitor
Analysis" brief for an AI marketing system. Every downstream content agent
(Articles, LinkedIn, Reddit, X) will read this as ground truth for how to
talk about competitors — accuracy matters more than sounding decisive. Write
with the judgment of someone who actually does competitive positioning for a
living, not a generic report generator.

Base every claim about a competitor on the crawled title/description provided
for it below (plus its Google Knowledge Graph entry when one is given — that's
a real, authoritative signal, not a guess)${hasWebSearch ? ", plus the web_search tool if you need to confirm or fill in something the crawl doesn't cover (current pricing, recent positioning, news)" : ""}.
If a competitor's crawl failed or its description is too thin to say anything
specific${hasWebSearch ? " even after searching" : ""}, say so plainly instead
of guessing what the company does. Never invent competitor pricing, feature
lists, or company size. Never disparage a competitor — describe differences
factually.

${GROUNDING_RULES}`;

    const competitorBlock = req.competitors
      .map(
        (c, i) =>
          `${i + 1}. ${c.url}\n   Title: ${c.title}\n   Description: ${c.description}` +
          (c.kgDescription ? `\n   Google Knowledge Graph: ${c.kgDescription}` : "")
      )
      .join("\n\n");

    const prompt = `Our product — ${req.projectName} (${req.url}):
Meta title: ${req.metaTitle || "(none found)"}
Meta description: ${req.metaDescription || "(none found)"}
Crawled page text (truncated): """${req.bodyText.slice(0, 2000) || "(none extracted)"}"""

Competitors (real crawled data — title + meta description only):
${competitorBlock}

Write a Competitor Analysis brief with exactly these section headers, in
this order. Write your actual answer under each header as plain Markdown —
never copy instruction text into your answer, never use angle brackets.

## Competitive Landscape
Write a Markdown table with columns "Competitor", "What they do" (one
sentence, from their crawled title/description only), and "Notable
difference vs ${req.projectName}" (one sentence, factual, no disparagement).
One row per competitor listed above. If a competitor's crawl failed, write
"Couldn't determine" in the relevant cells instead of guessing.

## Differentiation
Write 2-4 bullet points on how ${req.projectName} is positioned differently
from the competitors above, grounded only in the crawled data — not invented
feature comparisons.

## Gaps & Opportunities
Write 2-4 bullet points on possible content/positioning angles suggested by
comparing our page to the competitors' — e.g. a topic none of them cover in
their title/description, or a customer type they don't seem to target. If
the data is too thin to responsibly suggest anything, write exactly:
Not enough data yet — add more competitors or wait for their pages to be crawled again.`;

    return this.driver({
      apiKey: this.apiKey,
      model: req.model,
      system,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      baseUrl: this.baseUrl,
      tools: req.tavilyApiKey ? [buildWebSearchTool(req.tavilyApiKey)] : undefined,
    });
  }
}
