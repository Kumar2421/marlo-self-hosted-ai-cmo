import { GROUNDING_RULES } from "./grounding.ts";
import type { LlmDriver, CompletionResult } from "@/lib/llm";

export type MarketingStrategyRequest = {
  projectName: string;
  url: string;
  /** Real crawled page text from SEOAgent. */
  bodyText: string;
  metaTitle: string;
  metaDescription: string;
  /** Already-generated Product Information doc, if any — reused as grounding
   * so Marketing Strategy doesn't have to re-derive "what does this product
   * do" from scratch and risk drifting from it. */
  productInfo?: string;
  model: string;
};

/**
 * Mirrors okara.ai's real "Marketing Strategy" document (see refimages
 * Screenshot 2026-08-31 125015.png): Ideal Customer Profile (ICP),
 * Positioning Statement, Messaging Framework (a headline/copy table).
 * Grounded in the real crawl + Product Information doc — never invents an
 * ICP or messaging that isn't defensible from what's actually on the page.
 */
export class MarketingStrategyGenerator {
  private driver: LlmDriver;
  private apiKey: string;
  private baseUrl?: string;
  constructor(driver: LlmDriver, apiKey: string, baseUrl?: string) {
    this.driver = driver;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async generate(req: MarketingStrategyRequest): Promise<CompletionResult> {
    const system = `You are a B2B marketing strategist writing an internal "Marketing Strategy"
brief for an AI marketing system. Every downstream content agent (Articles,
LinkedIn, Reddit, X) will read this as ground truth for positioning and
audience — accuracy and defensibility matter more than sounding impressive.

Base your answer on the crawled page content, metadata, and Product
Information provided below. Where the page gives real signal (target
audience language, pricing model, competitor mentions), use it. Where it
doesn't, write reasonable, clearly-labeled inferences rather than confident
invented specifics — never state a percentage, dollar figure, or customer
count you weren't given.

${GROUNDING_RULES}`;

    const prompt = `Website: ${req.url}
Meta title: ${req.metaTitle || "(none found)"}
Meta description: ${req.metaDescription || "(none found)"}

Crawled page text (truncated):
"""
${req.bodyText || "(no readable text extracted from this page)"}
"""

${req.productInfo ? `Existing Product Information document:\n"""\n${req.productInfo}\n"""\n` : ""}
Write a Marketing Strategy brief titled "${req.projectName} — Marketing Strategy Document",
with exactly these section headers in this order. Write your actual answer
under each header as plain Markdown — never copy instruction text into your
answer, never use angle brackets in your output.

## 1. Ideal Customer Profile (ICP)
Write a **Primary:** paragraph describing the single most likely customer
segment, grounded in the page. Then a **Secondary:** paragraph for a
plausible second segment, if the page supports one — omit it if not.
Then a "Psychographic signals:" bulleted list of 3-5 short, concrete traits
(where they hang out, what tools they already use, what frustrates them) —
each bullet grounded in something on the page or a reasonable inference from it.

## 2. Positioning Statement
Write one paragraph in the classic "For [audience], [product] is the
[category] that [key benefit] — unlike [alternative], it [differentiator]."
shape, using ${req.projectName} and real details from the page.

## 3. Messaging Framework
Write a Markdown table with columns "Layer" and "Copy". Include these rows,
in order: Hero headline, Sub-headline, then 2-3 rows labeled "Value prop 1",
"Value prop 2", etc. Each Copy cell should be short, punchy marketing copy
consistent with the positioning statement above.`;

    return this.driver({
      apiKey: this.apiKey,
      model: req.model,
      system,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      baseUrl: this.baseUrl,
    });
  }
}
