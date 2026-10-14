import * as cheerio from "cheerio";
import { safeFetch } from "../net/safeFetch.ts";

export type CrawledContent = {
  title: string;
  description: string;
  pricingSection: string;
  featuresSection: string;
  aboutSection: string;
  rawText: string;
};

/**
 * Crawl competitor website and extract key sections.
 * Returns structured content ready for LLM summarization.
 */
export async function crawlCompetitorSite(url: string, timeoutMs: number = 10000): Promise<CrawledContent | null> {
  try {
    // Competitor URLs are user-supplied: guarded fetch (pinned DNS, per-hop checks, deadline, byte cap).
    const res = await safeFetch(url, {
      timeoutMs,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (res.status < 200 || res.status >= 300) return null;

    const $ = cheerio.load(res.bodyText);

    // Extract meta title & description
    const title = $("title").text().trim() || $("meta[property='og:title']").attr("content") || "";
    const description =
      $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      "";

    // Extract pricing section
    const pricingSection = extractPricingSection($);

    // Extract features section
    const featuresSection = extractFeaturesSection($);

    // Extract about/product info section
    const aboutSection = extractAboutSection($);

    // Get all visible text for fallback
    const rawText = $("body").text().trim().substring(0, 10000);

    return {
      title,
      description,
      pricingSection,
      featuresSection,
      aboutSection,
      rawText,
    };
  } catch (err) {
    console.log(`[crawler] Error crawling ${url}:`, err instanceof Error ? err.message : "unknown");
    return null;
  }
}

function extractPricingSection($: cheerio.CheerioAPI): string {
  const lines: string[] = [];

  // Look for common pricing page elements
  const selectors = [
    "h1, h2, h3",
    ".pricing",
    ".plans",
    ".price",
    "[class*='pricing']",
    "[class*='plan']",
    "[id*='pricing']",
    "[id*='plan']",
  ];

  // Find sections that likely contain pricing info
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 0 && text.length < 500) {
        // Filter for pricing-related keywords
        if (/price|plan|tier|month|annual|free|enterprise|cost|billing/i.test(text)) {
          lines.push(text);
        }
      }
    });
  }

  // Extract price tags specifically
  $("*").each((_, el) => {
    const text = $(el).text().trim();
    // Look for price patterns like $99, $9.99/month, etc
    if (/\$\d+|free|contact sales|custom pricing/i.test(text) && text.length < 200) {
      lines.push(text);
    }
  });

  return Array.from(new Set(lines)).slice(0, 20).join("\n");
}

function extractFeaturesSection($: cheerio.CheerioAPI): string {
  const lines: string[] = [];

  // Look for feature lists - expanded selectors
  const selectors = [
    ".features",
    ".benefits",
    ".capabilities",
    "[class*='feature']",
    "[class*='benefit']",
    "[class*='capabilit']",
    "[id*='feature']",
    "[id*='benefit']",
    "[data-section*='feature']",
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      // Extract all list items
      const items = $(el).find("li, div[class*='item'], div[class*='card']");
      if (items.length > 0) {
        items.each((_, item) => {
          const text = $(item).text().trim();
          if (text.length > 0 && text.length < 300) {
            lines.push(text);
          }
        });
      }
    });
  }

  // Look for all ul/ol lists (often contain features)
  $("ul, ol").each((_, el) => {
    const items = $(el).find("li");
    if (items.length >= 3) {  // Only take lists with 3+ items
      items.each((_, item) => {
        const text = $(item).text().trim();
        if (text.length > 5 && text.length < 300) {
          lines.push(text);
        }
      });
    }
  });

  // Also look for common feature header patterns
  $("h2, h3, h4").each((_, el) => {
    const text = $(el).text().trim();
    if (/feature|benefit|capability|include|support|tool|highlight|key|power|why/i.test(text)) {
      // Get next few elements
      const nextContent = $(el).next().text().trim().substring(0, 500);
      if (nextContent) lines.push(`${text}\n${nextContent}`);
    }
  });

  return Array.from(new Set(lines)).slice(0, 20).join("\n");
}

function extractAboutSection($: cheerio.CheerioAPI): string {
  const lines: string[] = [];

  // Look for about/product info sections
  const selectors = [".about", ".hero", "[class*='description']", "main > section:first-child"];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 50 && text.length < 1000) {
        lines.push(text);
      }
    });
  }

  // Get h1/h2 content (usually main product info)
  $("h1, h2").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 5 && text.length < 300) {
      lines.push(text);
    }
  });

  return Array.from(new Set(lines)).slice(0, 10).join("\n");
}
