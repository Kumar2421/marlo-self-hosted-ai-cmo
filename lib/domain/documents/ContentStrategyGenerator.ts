import { GROUNDING_RULES } from "./grounding.ts";
import type { LlmDriver, CompletionResult } from "@/lib/llm";
import { buildWebSearchTool } from "../shared/webSearchTool.ts";

export type ContentStrategyRequest = {
  projectName: string;
  url: string;
  bodyText: string;
  metaTitle: string;
  metaDescription: string;
  /** Reused as grounding, same principle as Marketing Strategy reusing
   * Product Info — these documents shouldn't independently re-derive facts
   * that already exist elsewhere and risk drifting apart. */
  productInfo?: string;
  marketingStrategy?: string;
  competitorAnalysis?: string;
  model: string;
  /** When set, the model gets a real web_search tool — this is the document
   * that needs it most, since a real content calendar has to reflect what's
   * actually being talked about right now, not invented trends. */
  tavilyApiKey?: string;
};

/**
 * No public reference screenshot exists for okara.ai's real "Content
 * Strategy" document (locked/paywalled in every capture we have — see
 * session research). Structure designed from what the 4 downstream agents
 * (Articles, LinkedIn, Reddit, X) actually need to act on: pillars, a
 * channel plan, a real researched topic backlog, and gaps cross-referenced
 * from Competitor Analysis.
 */
export class ContentStrategyGenerator {
  private driver: LlmDriver;
  private apiKey: string;
  private baseUrl?: string;
  constructor(driver: LlmDriver, apiKey: string, baseUrl?: string) {
    this.driver = driver;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async generate(req: ContentStrategyRequest): Promise<CompletionResult> {
    const hasWebSearch = !!req.tavilyApiKey;

    const system = `You are a senior B2B content strategist — the kind who has actually run a
content calendar, not a generic report generator. You're writing an internal
"Content Strategy" brief for an AI marketing system; every downstream content
agent (Articles, LinkedIn, Reddit, X) will execute directly against what you
write here.

Ground every pillar and topic in the product, positioning, and competitor
context provided below — never invent capabilities, customers, or market
trends the source material doesn't support.${
      hasWebSearch
        ? " You have a web_search tool — use it to find what's actually being discussed in this niche right now (recent posts, questions, trends) before writing the Topic Backlog, instead of guessing."
        : " You don't have web access this time, so base the Topic Backlog only on the product/competitor context below — say so plainly rather than inventing 'trending' topics you can't verify."
    }

${GROUNDING_RULES}`;

    const context = `Product: ${req.projectName} (${req.url})
Meta title: ${req.metaTitle || "(none found)"}
Meta description: ${req.metaDescription || "(none found)"}
Crawled page text (truncated): """${req.bodyText.slice(0, 2000) || "(none extracted)"}"""

${req.productInfo ? `Product Information document:\n"""\n${req.productInfo}\n"""\n\n` : ""}${
      req.marketingStrategy ? `Marketing Strategy document (ICP, positioning):\n"""\n${req.marketingStrategy}\n"""\n\n` : ""
    }${req.competitorAnalysis ? `Competitor Analysis document:\n"""\n${req.competitorAnalysis}\n"""\n\n` : ""}`;

    const prompt = `${context}Write a Content Strategy brief titled "${req.projectName} — Content Strategy Document",
with exactly these section headers in this order. Write your actual answer
under each header as plain Markdown — never copy instruction text into your
answer, never use angle brackets in your output.

## 1. Content Pillars
3-5 short pillar names, each with one sentence explaining why it matters to
the ICP above. Grounded in the product and audience — not generic SaaS
pillars that could belong to any company.

## 2. Channel Plan
A Markdown table with columns "Channel", "Cadence", "Primary Goal", "Format
notes". One row each for Articles, LinkedIn, Reddit, X — cadence and goal
should make sense for this specific product's audience and stage, not a
copy-pasted generic schedule.

## 3. Topic Backlog
A Markdown table with columns "Topic", "Pillar", "Channel", "Why now". 8-12
rows.${
      hasWebSearch
        ? " At least a few rows should reflect something real you found via web_search — cite what you searched for in \"Why now\", not a vague trend claim."
        : ""
    } Every topic must be something ${req.projectName} can credibly speak to.

## 4. Content Gaps
2-4 bullet points on angles competitors aren't covering. ${
      req.competitorAnalysis
        ? "Pull directly from the Competitor Analysis document's own gaps/opportunities above — don't re-derive independently."
        : 'No Competitor Analysis document exists yet for this project — write exactly: "Generate a Competitor Analysis document first for gap analysis grounded in real competitor data."'
    }`;

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
