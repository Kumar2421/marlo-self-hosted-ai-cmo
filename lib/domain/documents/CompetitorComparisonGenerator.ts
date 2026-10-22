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

export type ComparisonResult = {
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

export async function generateCompetitorComparison(
  competitors: { id: string; url: string }[],
  model: string,
  driver: LlmDriver,
  apiKey: string,
  baseUrl?: string
): Promise<ComparisonResult> {
  const results: CompetitorData[] = [];
  console.log(`[generator] Starting extraction for ${competitors.length} competitors`);
  console.log(`[generator] API key present: ${!!apiKey}, length: ${apiKey?.length || 0}`);
  console.log(`[generator] Model: ${model}, baseUrl: ${baseUrl || "default"}`);

  for (const comp of competitors) {
    console.log(`[generator] Crawling ${comp.url}...`);
    const crawled = await crawlCompetitorSite(comp.url);
    if (!crawled) {
      console.log(`[generator] Failed to crawl ${comp.url}`);
      continue;
    }
    console.log(`[generator] Crawled ${comp.url}: pricing=${crawled.pricingSection.length} bytes, features=${crawled.featuresSection.length} bytes`);

    const hostname = new URL(comp.url).hostname.replace("www.", "");

    try {
      // Build context from crawled sections
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
        messages: [
          {
            role: "user",
            content: buildComparisonExtractionPrompt(context),
          },
        ],
      });

      const text = res.text || "";
      console.log(`[generator] LLM response for ${comp.url}:`, text.substring(0, 200));

      let parsed: { startingPrice: string; features: string[] } = {
        startingPrice: "pricing not found",
        features: [],
      };

      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
          console.log(`[generator] Parsed JSON:`, parsed);
        } else {
          console.log(`[generator] No JSON found in response`);
        }
      } catch (e) {
        console.log(`[generator] JSON parse error:`, e);
      }

      results.push({
        id: comp.id,
        url: comp.url,
        name: hostname.charAt(0).toUpperCase() + hostname.slice(1),
        startingPrice: parsed.startingPrice || "pricing not found",
        features: Array.isArray(parsed.features) ? parsed.features.slice(0, 4) : [],
      });
      console.log(`[generator] Added result:`, results[results.length - 1]);
    } catch (err) {
      console.log(`[generator] Extraction error for ${comp.url}:`, err);
    }
  }
  console.log(`[generator] Final results: ${results.length} competitors`);

  return {
    competitors: results,
    generatedAt: new Date().toISOString().split("T")[0],
  };
}
