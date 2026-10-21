import type { SearchIntent } from "./types.ts";

/**
 * Lowercase, strip punctuation, collapse whitespace. Deliberately does NOT
 * stem: the exact wording people type is itself evidence.
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ordered by priority: the first matching family becomes the primary intent. */
const INTENT_FAMILIES: Array<{ intent: Exclude<SearchIntent, "brand" | "informational">; pattern: RegExp }> = [
  { intent: "alternative", pattern: /\b(alternatives?|replacements?|replace|instead of|competitors?)\b/ },
  { intent: "comparison", pattern: /\b(vs|versus|compare|compared|comparison)\b/ },
  { intent: "recommendation", pattern: /\b(best|top|recommended|leading|greatest)\b/ },
  { intent: "pricing", pattern: /\b(prices?|pricing|costs?|cheap|cheapest|affordable|free|plans?)\b/ },
  { intent: "review", pattern: /\b(reviews?|ratings?|testimonials?)\b/ },
  { intent: "how_to", pattern: /\b(how to|how do i|how can i|tutorial|guide|steps? to)\b/ },
  { intent: "problem", pattern: /\b(problems?|issues?|fix|errors?|not working|solutions?)\b/ },
  { intent: "audience", pattern: /\bfor (startups?|agenc(?:y|ies)|freelancers?|ecommerce|e commerce|saas|small business(?:es)?|enterprises?|beginners?|teams?)\b/ },
  { intent: "commercial", pattern: /\b(software|tools?|platform|service|services|agency|company|app|apps|buy|hire)\b/ },
];

const SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);

/**
 * Derive likely brand words from the project name and website domain, e.g.
 * "Marlo SEO" + "https://www.marlo.ai" → ["marlo", "seo"]. Short words are
 * dropped because they match too much unrelated traffic.
 */
export function brandTermsFrom(name: string | null | undefined, url: string | null | undefined): string[] {
  const terms = new Set<string>();
  for (const word of normalizeQuery(name ?? "").split(" ")) {
    if (word.length >= 3) terms.add(word);
  }
  const label = registrableLabel(url);
  if (label.length >= 3) terms.add(label);
  return [...terms];
}

/** The brand label of a URL or domain ("https://www.marlo.ai" -> "marlo", "shop.acme.co.uk" -> "acme"). Empty when unparseable. */
export function registrableLabel(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const labels = new URL(url.includes("://") ? url : `https://${url}`).hostname.split(".");
    labels.pop(); // TLD
    if (labels.length > 1 && SECOND_LEVEL_LABELS.has(labels[labels.length - 1])) labels.pop(); // co.uk, com.au
    return normalizeQuery(labels[labels.length - 1] ?? "").replace(/ /g, "");
  } catch {
    return ""; // Unparseable URL: callers fall back to name-derived terms only.
  }
}

function matchesBrand(normalized: string, brandTerms: string[]): boolean {
  if (brandTerms.length === 0) return false;
  const words = normalized.split(" ");
  return brandTerms.some((term) => matchesAsWords(words, term));
}

/** True if `term` equals one word, or consecutive words joined ("okara alternative" → "okaraalternative"). */
function matchesAsWords(words: string[], term: string): boolean {
  for (let start = 0; start < words.length; start += 1) {
    let joined = "";
    for (let end = start; end < words.length && joined.length < term.length; end += 1) {
      joined += words[end];
      if (joined === term) return true;
    }
  }
  return false;
}

export type IntentClassification = { intent: SearchIntent; signals: SearchIntent[] };

/**
 * Deterministic, explainable intent classification. `signals` lists every
 * family that matched; `intent` is the highest-priority one (brand first).
 */
export function classifyQuery(query: string, brandTerms: string[] = []): IntentClassification {
  const normalized = normalizeQuery(query);
  const signals: SearchIntent[] = [];
  if (matchesBrand(normalized, brandTerms)) signals.push("brand");
  for (const family of INTENT_FAMILIES) {
    if (family.pattern.test(normalized)) signals.push(family.intent);
  }
  if (signals.length === 0) return { intent: "informational", signals: ["informational"] };
  return { intent: signals[0], signals };
}
