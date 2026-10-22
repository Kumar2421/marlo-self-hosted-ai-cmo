import { GROUNDING_RULES } from "./grounding.ts";
import type { LlmDriver } from "@/lib/llm";
import { crawlCompetitorSite } from "../shared/webCrawler.ts";

export type CompetitorData = {
  id: string;
  url: string;
  name: string;
  startingPrice: string;
  features: string[];
};

/** The user's own product. `extracted: false` means the site could not be read, so price/features are unknown. */
export type OwnProductData = CompetitorData & { extracted: boolean };

export type ComparisonResult = {
  ownProduct?: OwnProductData;
  competitors: CompetitorData[];
  generatedAt: string;
};

export function buildComparisonExtractionPrompt(context: string): string {
  return `Extract pricing and 3-4 key features. Return only JSON:
{"startingPrice":"$X/month or free or contact sales","features":["feature1","feature2","feature3"]}

Use ONLY what the context below states. If pricing is not stated, use "pricing not found"; if fewer than 3 features are stated, return fewer. Never guess a price or feature.

${GROUNDING_RULES}

Context:
${context}`;
}

type Extracted = { startingPrice: string; features: string[] };

/** Crawl one site and run the grounded extraction prompt. Returns null if the site or LLM call failed. */
async function extractSite(
  url: string,
  model: string,
  driver: LlmDriver,
  apiKey: string,
  baseUrl?: string
): Promise<(Extracted & { hostname: string }) | null> {
  console.log(`[generator] Crawling ${url}...`);
  const crawled = await crawlCompetitorSite(url);
  if (!crawled) {
    console.log(`[generator] Failed to crawl ${url}`);
    return null;
  }
  let hostname = url;
  try {
    hostname = new URL(url).hostname.replace("www.", "");
  } catch {
    // keep raw url
  }

  try {
    const context = `
Product: ${crawled.title || hostname}
Description: ${crawled.description}

Pricing Information:
${crawled.pricingSection || "(not found)"}

Features & Benefits:
${crawled.featuresSection || "(not found)"}

About:
${crawled.aboutSection || "(not found)"}
`.trim();

    const res = await driver({
      apiKey,
      model,
      baseUrl,
      messages: [{ role: "user", content: buildComparisonExtractionPrompt(context) }],
    });

    let parsed: Extracted = { startingPrice: "pricing not found", features: [] };
    try {
      const jsonMatch = (res.text || "").match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.log(`[generator] JSON parse error:`, e);
    }
    return {
      hostname,
      startingPrice: parsed.startingPrice || "pricing not found",
      features: Array.isArray(parsed.features) ? parsed.features.slice(0, 4) : [],
    };
  } catch (err) {
    console.log(`[generator] Extraction error for ${url}:`, err);
    return null;
  }
}

export async function generateCompetitorComparison(
  competitors: { id: string; url: string }[],
  model: string,
  driver: LlmDriver,
  apiKey: string,
  baseUrl?: string,
  own?: { name: string; url: string }
): Promise<ComparisonResult> {
  const results: CompetitorData[] = [];

  // The user's own site goes through the same pipeline, inside this same run (no extra charge).
  let ownProduct: OwnProductData | undefined;
  if (own?.url) {
    const got = await extractSite(own.url, model, driver, apiKey, baseUrl);
    ownProduct = {
      id: "own",
      url: own.url,
      name: own.name,
      startingPrice: got?.startingPrice ?? "",
      features: got?.features ?? [],
      extracted: !!got,
    };
  }

  for (const comp of competitors) {
    const got = await extractSite(comp.url, model, driver, apiKey, baseUrl);
    if (!got) continue;
    results.push({
      id: comp.id,
      url: comp.url,
      name: got.hostname.charAt(0).toUpperCase() + got.hostname.slice(1),
      startingPrice: got.startingPrice,
      features: got.features,
    });
  }

  return {
    ownProduct,
    competitors: results,
    generatedAt: new Date().toISOString().split("T")[0],
  };
}
