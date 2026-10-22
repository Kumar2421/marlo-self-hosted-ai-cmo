import { GROUNDING_RULES } from "./grounding.ts";
import type { LlmDriver, CompletionResult } from "@/lib/llm";

export type ProductInfoRequest = {
  projectName: string;
  url: string;
  /** Real crawled page text from SEOAgent — the actual grounding material.
   * Without this the LLM would have to invent pricing/features/customers,
   * which this generator explicitly forbids in its prompt. */
  bodyText: string;
  metaTitle: string;
  metaDescription: string;
  model: string;
};

/**
 * Mirrors okara.ai's real "Product Information" document (see refimages
 * Screenshot 2026-08-31 124957.png): Overview (name/website/one-liner), What
 * It Does, Product Category, Target Customers, Business Model, Pricing, Key
 * Features. Grounded entirely in the real crawled page — instructed to admit
 * gaps rather than invent pricing/feature claims that aren't actually on the
 * page (a marketing site often doesn't list pricing publicly, for example).
 */
export class ProductInfoGenerator {
  private driver: LlmDriver;
  private apiKey: string;
  private baseUrl?: string;
  constructor(driver: LlmDriver, apiKey: string, baseUrl?: string) {
    this.driver = driver;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async generate(req: ProductInfoRequest): Promise<CompletionResult> {
    const system = `You are a product analyst writing an internal "Product Information" brief for
an AI marketing system. Every downstream agent (SEO, content, social) will
read this document as ground truth — accuracy matters more than completeness.

Base your answer ONLY on the crawled page content and metadata provided below.
If the page doesn't state something (e.g. exact pricing, specific target
customer segments), write "Not stated on the page" for that item instead of
guessing or inventing plausible-sounding details. Never fabricate numbers,
customer counts, feature lists, or pricing that isn't actually present in the
source material.

${GROUNDING_RULES}`;

    const prompt = `Website: ${req.url}
Meta title: ${req.metaTitle || "(none found)"}
Meta description: ${req.metaDescription || "(none found)"}

Crawled page text (truncated):
"""
${req.bodyText || "(no readable text extracted from this page)"}
"""

Write a Product Information brief with exactly these section headers, in this
order. Under each header, write your actual answer as plain Markdown — never
copy the instruction text itself into your answer, and never use angle
brackets in your output.

## Overview
Include these three lines, each on its own line:
**Product Name:** ${req.projectName}
**Website:** ${req.url}
**One-liner:** then one sentence covering what it does and for whom, in plain language.

## What It Does
Write 2-4 sentences of factual description, grounded in the crawled text above.

## Product Category
Write 3-5 short bullet points (e.g. "invoice payment reminder tool").

## Target Customers
Write 1-2 sentences describing who this is for, based only on evidence in the page.
If the page gives no signal about who the customer is, write exactly:
Not stated on the page

## Business Model
Write 2-4 bullet points on how the product likely makes money, only if stated on the page.
If nothing on the page indicates the business model, write exactly:
Not stated on the page

## Pricing
Write the pricing details exactly as stated on the page, if any are present.
If no pricing appears anywhere on the page, write exactly this and nothing else:
Not stated on the page

## Key Features
Write 3-6 bullet points of specific features actually described in the crawled text.`;

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
