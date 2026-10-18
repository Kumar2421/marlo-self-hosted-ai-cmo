import { parseRobots, patternMatches, rulesFor, type RobotsRule } from "../net/robotsPolicy.ts";

export const AI_CRAWLERS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"] as const;

/**
 * What we learned about one file. "missing" means the server really answered
 * 404/410. "unknown" means we could not tell (network error, timeout, 403,
 * 5xx, blocked URL) and must never be read as pass or fail.
 */
export type Fetched = { state: "ok"; body: string } | { state: "missing" } | { state: "unknown" };

export type ReadinessInput = {
  robots: Fetched;
  llms: Fetched;
  sitemapXml: Fetched;
  /** Homepage HTML, or null when it could not be fetched. */
  homepageHtml: string | null;
};

export type CheckStatus = "pass" | "fail" | "unknown";

export type ReadinessCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  /** Plain-language explanation of what we saw. */
  detail: string;
  /** What to do when it fails. */
  fix: string;
  weight: number;
};

export type ReadinessResult = {
  method: "readiness";
  score: number;
  checks: ReadinessCheck[];
};

/** Disallow values that block everything, even though only "/" literally says so. */
const BLOCK_ALL = new Set(["/", "/*", "/*?"]);

function ruleMatchesRoot(rule: RobotsRule): boolean {
  if (!rule.allow && BLOCK_ALL.has(rule.pattern)) return true;
  return patternMatches(rule.pattern, "/");
}

/**
 * Does robots.txt block this crawler from the whole site (the root path)?
 * A named group beats the "*" group. Within the applicable rules the longest
 * matching pattern wins; on a tie Allow wins (the robots.txt standard).
 */
export function crawlerBlocked(robotsTxt: string, agent: string): boolean {
  let bestLen = -1;
  let blocked = false;
  for (const rule of rulesFor(parseRobots(robotsTxt), agent)) {
    if (!ruleMatchesRoot(rule)) continue;
    const len = rule.pattern.length;
    if (len > bestLen || (len === bestLen && rule.allow)) {
      bestLen = len;
      blocked = !rule.allow;
    }
  }
  return blocked;
}

export function hasJsonLd(html: string): boolean {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const body = m[1].trim();
    if (!body) continue;
    try {
      JSON.parse(body);
      return true;
    } catch {
      // a malformed block does not count
    }
  }
  return false;
}

export function headingStructure(html: string): { h1: number; h2: number; questionHeadings: number; faqSchema: boolean } {
  const count = (tag: string) => (html.match(new RegExp(`<${tag}[\\s>]`, "gi")) ?? []).length;
  const headings = [...html.matchAll(/<h[2-3][^>]*>([\s\S]*?)<\/h[2-3]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
  const questionHeadings = headings.filter((h) => /\?\s*$/.test(h) || /^(how|what|why|when|which|can|does|is|are)\b/i.test(h)).length;
  return { h1: count("h1"), h2: count("h2"), questionHeadings, faqSchema: /"@type"\s*:\s*"FAQPage"/i.test(html) };
}

export function evaluateReadiness(input: ReadinessInput): ReadinessResult {
  const checks: ReadinessCheck[] = [];

  const LLMS = { id: "llms-txt", label: "llms.txt file", weight: 10 };
  if (input.llms.state === "unknown") {
    checks.push({ ...LLMS, status: "unknown", detail: "We could not check for llms.txt (the request failed or was refused).", fix: "" });
  } else if (input.llms.state === "ok" && input.llms.body.trim().length > 0) {
    checks.push({ ...LLMS, status: "pass", detail: "Your site has an llms.txt file that tells AI tools what it is about.", fix: "" });
  } else {
    checks.push({
      ...LLMS,
      status: "fail",
      detail: input.llms.state === "ok" ? "Your llms.txt file is empty." : "No llms.txt file was found.",
      fix: "Add a short /llms.txt that summarises your product and links to your key pages.",
    });
  }

  for (const bot of AI_CRAWLERS) {
    const id = `crawler-${bot.toLowerCase()}`;
    const label = `${bot} allowed`;
    if (input.robots.state === "unknown") {
      checks.push({ id, label, status: "unknown", detail: "We could not read your robots.txt (the request failed or was refused), so we cannot say whether this crawler is blocked.", fix: "", weight: 10 });
    } else if (input.robots.state === "missing") {
      checks.push({ id, label, status: "pass", detail: "Your robots.txt does not exist (404), so nothing blocks this crawler.", fix: "", weight: 10 });
    } else if (crawlerBlocked(input.robots.body, bot)) {
      checks.push({ id, label, status: "fail", detail: `Your robots.txt blocks ${bot} from the whole site.`, fix: `Remove the "Disallow: /" rule that applies to ${bot} in robots.txt if you want AI tools to read your site.`, weight: 10 });
    } else {
      checks.push({ id, label, status: "pass", detail: `${bot} is not blocked.`, fix: "", weight: 10 });
    }
  }

  const SITEMAP = { id: "sitemap", label: "Sitemap", weight: 15 };
  const robotsSitemap = input.robots.state === "ok" && /^\s*sitemap\s*:/im.test(input.robots.body);
  const xmlSitemap = input.sitemapXml.state === "ok" && /<(urlset|sitemapindex)[\s>]/i.test(input.sitemapXml.body);
  if (robotsSitemap || xmlSitemap) {
    checks.push({ ...SITEMAP, status: "pass", detail: "A sitemap was found.", fix: "" });
  } else if (input.sitemapXml.state === "unknown") {
    checks.push({ ...SITEMAP, status: "unknown", detail: "We could not check for a sitemap (the request failed or was refused).", fix: "" });
  } else {
    checks.push({ ...SITEMAP, status: "fail", detail: "No sitemap was found.", fix: "Publish /sitemap.xml and reference it in robots.txt so crawlers can find every page." });
  }

  if (input.homepageHtml === null) {
    checks.push(
      { id: "schema", label: "Structured data (JSON-LD)", status: "unknown", detail: "We could not load your homepage.", fix: "", weight: 20 },
      { id: "structure", label: "Clear headings and FAQ", status: "unknown", detail: "We could not load your homepage.", fix: "", weight: 15 },
    );
  } else {
    checks.push(
      hasJsonLd(input.homepageHtml)
        ? { id: "schema", label: "Structured data (JSON-LD)", status: "pass", detail: "Your homepage has valid structured data.", fix: "", weight: 20 }
        : { id: "schema", label: "Structured data (JSON-LD)", status: "fail", detail: "No valid JSON-LD structured data on your homepage.", fix: "Add Organization (and Product or SoftwareApplication) JSON-LD to your homepage.", weight: 20 },
    );
    const s = headingStructure(input.homepageHtml);
    const good = s.h1 === 1 && s.h2 >= 2 && (s.questionHeadings > 0 || s.faqSchema);
    checks.push(
      good
        ? { id: "structure", label: "Clear headings and FAQ", status: "pass", detail: "One main heading, several sections and question-style content.", fix: "", weight: 15 }
        : {
            id: "structure",
            label: "Clear headings and FAQ",
            status: "fail",
            detail: `Found ${s.h1} main heading(s), ${s.h2} section heading(s) and ${s.questionHeadings} question-style heading(s).`,
            fix: "Use exactly one H1, break the page into H2 sections, and add a short FAQ that answers real buyer questions.",
            weight: 15,
          },
    );
  }

  // Unknown checks are left out of the denominator so a fetch failure does not look like a bad site.
  const scored = checks.filter((c) => c.status !== "unknown");
  const total = scored.reduce((s, c) => s + c.weight, 0);
  const earned = scored.filter((c) => c.status === "pass").reduce((s, c) => s + c.weight, 0);
  return { method: "readiness", score: total === 0 ? 0 : Math.round((earned / total) * 100), checks };
}
