import { isGenericLabel } from "../project/projectName.ts";

export type SearchHit = { title: string; url: string; content: string };

export type CompetitorCandidate = { domain: string; reason: string };

/** Review sites, marketplaces, social, news and dev platforms: they list competitors, they are not competitors. */
const NOT_COMPETITORS = new Set([
  "g2.com", "capterra.com", "getapp.com", "softwareadvice.com", "trustradius.com", "trustpilot.com",
  "sourceforge.net", "alternativeto.net", "producthunt.com", "saasworthy.com", "slashdot.org",
  "reddit.com", "quora.com", "medium.com", "substack.com", "youtube.com", "linkedin.com",
  "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "pinterest.com",
  "wikipedia.org", "github.com", "gitlab.com", "stackoverflow.com", "news.ycombinator.com",
  "forbes.com", "techcrunch.com", "techradar.com", "pcmag.com", "zdnet.com", "cnet.com",
  "gartner.com", "crunchbase.com", "similarweb.com", "appsumo.com", "zapier.com",
  "google.com", "apple.com", "amazon.com", "play.google.com", "apps.apple.com", "chromewebstore.google.com",
  "blogspot.com", "wordpress.com", "wixsite.com", "notion.site", "ghost.io",
  // Big generic portals / marketplaces / directories: never a competitor of a software product.
  "redfin.com", "zillow.com", "realtor.com", "trulia.com", "yelp.com", "tripadvisor.com", "booking.com",
  "airbnb.com", "ebay.com", "etsy.com", "walmart.com", "indeed.com", "glassdoor.com", "bing.com", "yahoo.com",
  "microsoft.com", "nytimes.com", "bbc.com", "cnn.com", "bloomberg.com", "reuters.com", "quora.com",
  "grammarly.com", "cbinsights.com", "pitchbook.com", "owler.com", "zoominfo.com", "dnb.com", "apollo.io",
  "upwork.com", "fiverr.com", "freelancer.com", "toptal.com", "goodfirms.co", "designrush.com", "sortlist.com",
  "themanifest.com", "topdevelopers.co", "softwaresuggest.com", "alternativeto.com", "stackshare.io",
  "hubspot.com", "shopify.com", "dev.to", "hashnode.com", "angel.co", "wellfound.com", "clutch.co", "g2crowd.com",
]);

/** Hostnames that name a listing/directory/review/consumer-portal business rather than a vendor. */
const MARKETPLACE_HOST = /(realty|realestate|real-estate|mortgage|apartment|listings?|directory|reviews?\b|coupon|grammar|marketplace)/i;

/** Single source of truth for "this domain lists/hosts competitors but is not one". */
export function isDeniedDomain(host: string): boolean {
  const h = normalizeHost(host);
  if (MARKETPLACE_HOST.test(h)) return true;
  for (const blocked of NOT_COMPETITORS) {
    if (h === blocked || h.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

export function filterDeniedCandidates<T extends { domain: string }>(candidates: T[]): T[] {
  return candidates.filter((c) => !isDeniedDomain(c.domain));
}

const COMPARISON_PATH = /alternative|compar|\bvs\b|versus|competitor/i;
const DOMAIN_IN_TEXT = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|io|ai|co|app|dev|net|org|so|xyz))\b/gi;

const MAX_CANDIDATES = 12;
const MIN_SCORE = 2;

export function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
}

function isExcluded(host: string, ownHost: string): boolean {
  if (!host || !host.includes(".") || host === ownHost || host.endsWith(`.${ownHost}`)) return true;
  return isDeniedDomain(host);
}

/** Words that carry no category meaning on their own. */
const STOPWORDS = new Set((
  "a an the and or of for to in on at by with from as is are be this that these those it its our your their we you they " +
  "about into over more most best top new all any can will helps help helping provides provide offers offer using use used " +
  "get make made makes build builds built building deliver delivers delivering enable enables empower empowers power powers " +
  "company companies business businesses solution solutions platform platforms software service services product products " +
  "tool tools app apps website site online digital modern leading world class based powered ai-powered team teams customers " +
  "customer people everything one single simple easy fast better smarter way ways home welcome official page pages free"
).split(" "));

function stem(w: string): string {
  let t = w;
  if (t.length > 4) t = t.replace(/(ing|ion|ers|er|ed|es|s)$/, "");
  if (t.length > 4) t = t.replace(/e$/, "");
  return t;
}

function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if ((w.length < 3 && w !== "ai" && w !== "ml") || STOPWORDS.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

/** Terms that appear across many industries: they count for half. */
const BROAD = new Set(["crm", "system", "custom", "high", "performance", "tool", "data", "management", "marketing", "sales", "cloud", "smart", "web", "mobile", "design", "deploy"].map(stem));

/** Consumer / vertical-industry words: a candidate using one that the product never mentions sells to a different market. */
const VERTICAL = new Set((
  "real estate realtor realty mortgage mortgages apartment apartments homebuyer homebuyers rental rentals property properties " +
  "grammar spelling proofreading writing hotel hotels flights travel restaurant restaurants recipe recipes dating fitness " +
  "insurance loans lending casino betting coupons coupon fashion apparel jewelry furniture construction contractor roofing " +
  "plumbing dental clinic hospital pharmacy wedding"
).split(" ").map(stem));

/** Minimum score for a candidate to be shown. */
export const MIN_RELEVANCE = 2;
/** Hard cap on competitors added per discovery run. */
export const MAX_COMPETITORS = 8;

/**
 * Deterministic relevance of a candidate's title + snippet + domain to the product text: the number of distinct
 * informative product terms it shares (broad terms like "crm" count half). A candidate that talks about an
 * industry the product never mentions (real estate, grammar...) scores 0. With no candidate text there is no
 * evidence, so the score is 0. With no product text there is nothing to judge against, so the score is neutral.
 */
export function relevanceScore(productText: string, candidateText: string): number {
  const product = terms(productText);
  if (product.size < 3) return MIN_RELEVANCE;
  const candidate = terms(candidateText.replace(/\([^)]*\)/g, " ")); // drop "(no title found)" placeholders
  if (candidate.size < 3) return 0;
  for (const t of candidate) if (VERTICAL.has(t) && !product.has(t)) return 0;
  let score = 0;
  for (const t of candidate) if (product.has(t)) score += BROAD.has(t) ? 0.5 : 1;
  return score;
}

export function isRelevantToProduct(productText: string, candidateText: string): boolean {
  return relevanceScore(productText, candidateText) >= MIN_RELEVANCE;
}

export type VerifiedCandidate = { domain: string; reason: string; title: string; description: string };

/** Keep only confidently relevant candidates, best first, at most MAX_COMPETITORS. Returns fewer (or none) rather than padding. */
export function selectConfidentCompetitors<T extends VerifiedCandidate>(productText: string, candidates: T[]): T[] {
  return candidates
    .filter((c) => !isDeniedDomain(c.domain))
    .map((c) => ({ c, score: relevanceScore(productText, `${c.title} ${c.description} ${c.domain.replace(/[.-]/g, " ")}`) }))
    .filter((x) => x.score >= MIN_RELEVANCE)
    .sort((a, b) => b.score - a.score || a.c.domain.localeCompare(b.c.domain))
    .slice(0, MAX_COMPETITORS)
    .map((x) => x.c);
}

export const NO_CONFIDENT_COMPETITORS_NOTE = "We could not find confident competitors for this product. Add yours.";

/** The product's category in a few words: the title minus the brand, else the first sentence of the description. */
export function productCategory(projectName: string, metaTitle: string, description = ""): string {
  const name = projectName.trim();
  const fromTitle = metaTitle
    .replace(name ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig") : /$^/, "")
    .replace(/[|\-–—:·•]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (fromTitle.length >= 6 && fromTitle.length <= 80) return fromTitle;
  const sentence = description.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  const words = sentence.split(" ").filter(Boolean).slice(0, 12).join(" ").replace(/[.!?,;:]+$/, "");
  return words.length >= 6 ? words : "";
}

/**
 * The queries that surface real competitors, built from what the product DOES (category / description).
 * Brand-name queries are only added when the name is a real brand, never a generic label like "Home".
 */
export function buildDiscoveryQueries(projectName: string, metaTitle: string, description = ""): string[] {
  const name = projectName.trim();
  const category = productCategory(name, metaTitle, description);
  const offers = offerPhrases(`${metaTitle} ${description}`);
  // A sentence taken from a description that starts with a verb ("designs, builds, deploys...") is not a category.
  const titleCategory = productCategory(name, metaTitle, "");
  const useCategory = offers.length === 0 || titleCategory ? category : "";
  const queries: string[] = [];
  for (const o of offers) queries.push(`${o} alternatives`, `best ${o}`);
  if (useCategory) queries.push(`best ${useCategory} alternatives`);
  if (name && !isGenericLabel(name)) {
    queries.push(`${name} alternatives`, `${name} competitors`, `${name} vs`, `alternatives to ${name}`);
  } else if (useCategory) {
    queries.push(`${useCategory} competitors`, `top ${useCategory} companies`);
  }
  return [...new Set(queries.filter((q) => q.length > 0))].slice(0, 8);
}

/** Specific category + offer phrases found in the product text (what it sells, not generic words like "CRM"). */
function offerPhrases(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  const customSoftware = /custom software|software development|bespoke|web development|app development|software studio/.test(t);
  const ai = /\bai\b|artificial intelligence|machine learning|\bllm\b|automation/.test(t);
  if (customSoftware) out.push("custom software development company");
  if (ai && /business|system|integrat|workflow|automation|enterprise/.test(t)) out.push("AI automation agency for business systems");
  if (customSoftware && /\bcrm\b/.test(t)) out.push("custom CRM development agency");
  return out;
}

type Signal = { score: number; queries: Set<number>; mentionedIn: Set<number>; comparisonPage: boolean };

/**
 * Turn raw web-search results into competitor candidates with no AI.
 *
 * Two signals, both from real results:
 * - a company's own site appearing for "<product> alternatives/vs" searches
 *   (extra weight when the page itself is a comparison page);
 * - a company's domain written inside review/listicle snippets (which
 *   themselves are never candidates).
 * A domain must be supported by at least two signals, so a single stray
 * result is not enough. Every candidate is still fetched and verified by the
 * caller before it is saved.
 */
export function extractCompetitorCandidates(resultSets: SearchHit[][], ownDomain: string, productText = ""): CompetitorCandidate[] {
  const own = normalizeHost(ownDomain);
  const signals = new Map<string, Signal>();
  const bump = (host: string): Signal => {
    let s = signals.get(host);
    if (!s) {
      s = { score: 0, queries: new Set(), mentionedIn: new Set(), comparisonPage: false };
      signals.set(host, s);
    }
    return s;
  };

  let hitId = 0;
  resultSets.forEach((hits, queryIndex) => {
    for (const hit of hits) {
      hitId += 1;
      const host = normalizeHost(hit.url);

      const onTopic = !productText || relevanceScore(productText, `${hit.title} ${hit.content} ${host.replace(/[.-]/g, " ")}`) >= 1;
      if (!isExcluded(host, own) && onTopic) {
        const s = bump(host);
        if (!s.queries.has(queryIndex)) {
          s.queries.add(queryIndex);
          s.score += 1;
        }
        if (!s.comparisonPage && COMPARISON_PATH.test(`${hit.url} ${hit.title}`)) {
          s.comparisonPage = true;
          s.score += 1;
        }
      }

      // Domains named in the text of the result (typical for listicle / review snippets).
      const seenInHit = new Set<string>();
      for (const match of hit.content.matchAll(DOMAIN_IN_TEXT)) {
        const mentioned = normalizeHost(match[1]);
        if (mentioned === host || seenInHit.has(mentioned) || isExcluded(mentioned, own)) continue;
        seenInHit.add(mentioned);
        const s = bump(mentioned);
        if (!s.mentionedIn.has(hitId)) {
          s.mentionedIn.add(hitId);
          s.score += 1;
        }
      }
    }
  });

  return [...signals.entries()]
    .filter(([, s]) => s.score >= MIN_SCORE)
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, MAX_CANDIDATES)
    .map(([domain, s]) => ({ domain, reason: describe(s) }));
}

function describe(s: Signal): string {
  const parts: string[] = [];
  if (s.queries.size > 0) {
    parts.push(`appeared in ${s.queries.size} competitor-style search${s.queries.size === 1 ? "" : "es"}`);
  }
  if (s.comparisonPage) parts.push("has a comparison page");
  if (s.mentionedIn.size > 0) {
    parts.push(`named in ${s.mentionedIn.size} review or comparison result${s.mentionedIn.size === 1 ? "" : "s"}`);
  }
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}
