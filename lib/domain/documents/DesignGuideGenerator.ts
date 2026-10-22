import { GROUNDING_RULES } from "./grounding.ts";
import type { LlmDriver, CompletionResult } from "@/lib/llm";

export type DesignGuideRequest = {
  projectName: string;
  url: string;
  /** Real cheerio-extracted signals from SEOAgent's crawl — see
   * SEOAuditPayload.design. Every field is genuinely optional: a static
   * HTML/CSS crawl can't see computed styles, so a site with no theme-color
   * meta tag, no Google Fonts embed, and no obviously-labeled logo image
   * legitimately has nothing here to report. */
  themeColor?: string;
  fonts: string[];
  logoUrl?: string;
  faviconUrl?: string;
  ogImageUrl?: string;
  /** Reused for the Voice-Visual Pairing section — same cross-doc grounding
   * principle as Content Strategy reusing Marketing Strategy. */
  marketingStrategy?: string;
  model: string;
};

/**
 * No public reference screenshot exists for okara.ai's real "Design Guide"
 * (locked/paywalled in every capture — see session research, same situation
 * Content Strategy was in before it was built). Grounded only in what a
 * static crawl can actually see — no invented hex codes, no invented font
 * names, no invented "brand personality" language beyond what the real
 * signals support.
 */
export class DesignGuideGenerator {
  private driver: LlmDriver;
  private apiKey: string;
  private baseUrl?: string;
  constructor(driver: LlmDriver, apiKey: string, baseUrl?: string) {
    this.driver = driver;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async generate(req: DesignGuideRequest): Promise<CompletionResult> {
    const system = `You are a senior brand/creative director writing an internal "Design Guide" brief
for an AI marketing system. Every field you're given below was extracted
directly from a real crawl of the site's HTML — never invent a hex code, font
name, logo description, or "brand personality" claim beyond what's actually
provided. Where a signal is missing, say so plainly (write exactly "Not
stated on the page") instead of guessing what it probably looks like. A
static HTML crawl can't see computed CSS styles, so plenty of real sites will
legitimately have gaps here — that's expected, not a failure to report.

${GROUNDING_RULES}`;

    const prompt = `Product: ${req.projectName} (${req.url})

Real extracted signals:
- Theme color (meta tag): ${req.themeColor || "Not stated on the page"}
- Fonts found (from Google Fonts embeds): ${req.fonts.length > 0 ? req.fonts.join(", ") : "Not stated on the page"}
- Logo image URL: ${req.logoUrl || "Not stated on the page"}
- Favicon URL: ${req.faviconUrl || "Not stated on the page"}
- Social share image (og:image): ${req.ogImageUrl || "Not stated on the page"}

${req.marketingStrategy ? `Marketing Strategy document (brand voice, positioning):\n"""\n${req.marketingStrategy.slice(0, 1500)}\n"""\n` : ""}
Write a Design Guide brief titled "${req.projectName} — Design Guide", with
exactly these section headers in this order. Write your actual answer under
each header as plain Markdown — never copy instruction text into your
answer, never use angle brackets in your output.

## 1. Brand Colors
A Markdown table with columns "Role", "Value", "Source". Include a "Theme
color" row using the real value above (or "Not stated on the page"). Don't
add rows for colors you weren't given.

## 2. Typography
State the font(s) found, labeled clearly. If none were found, write exactly:
Not stated on the page — no Google Fonts embed was found in the crawled HTML; the site may use system fonts or self-hosted fonts a static crawl can't detect.

## 3. Logo & Imagery
List the logo, favicon, and social image URLs given above, each labeled
(write "Not stated on the page" for any that are missing). Then, only if at
least one real color or image signal exists above, write one short paragraph
describing the likely visual style grounded only in what was actually found.
If none of theme color, fonts, logo, or social image were found, write
exactly instead: Not enough visual data on this page to describe a style —
this crawl found no theme-color tag, Google Fonts embed, or labeled logo image.

## 4. Voice-Visual Pairing
${
  req.marketingStrategy
    ? "One short paragraph connecting the brand voice/positioning above to how visual content (social posts, UGC video, imagery) should feel — grounded in the Marketing Strategy document, not invented."
    : 'No Marketing Strategy document exists yet for this project — write exactly: "Generate a Marketing Strategy document first for voice-visual pairing grounded in real positioning."'
}`;

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
