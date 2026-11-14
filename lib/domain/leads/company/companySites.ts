import type { SearchHit } from "../../websearch/searchProvider.ts";

/**
 * Turning web results into candidate COMPANY websites: drop social networks, directories, marketplaces, news
 * and listicles, keep one homepage per company. Pure, so the rules are testable without a network.
 */

const NOT_A_COMPANY_SITE = [
  // social and community
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "pinterest.com", "tiktok.com",
  "reddit.com", "quora.com", "medium.com", "wikipedia.org", "github.com", "substack.com",
  // directories, review sites, lead databases
  "justdial.com", "indiamart.com", "sulekha.com", "yellowpages.com", "yelp.com", "tripadvisor.com", "trustpilot.com",
  "clutch.co", "g2.com", "capterra.com", "crunchbase.com", "glassdoor.com", "naukri.com", "indeed.com", "goodfirms.co",
  "leadiq.com", "zoominfo.com", "apollo.io", "rocketreach.co", "lusha.com", "dnb.com", "manta.com", "bbb.org",
  "mapquest.com", "foursquare.com", "yellowpages.ca", "hotfrog.com", "cylex.com", "bark.com", "thumbtack.com",
  // startup and agency directories, freelancer and consultant marketplaces
  "tracxn.com", "owler.com", "pitchbook.com", "wellfound.com", "angel.co", "f6s.com", "producthunt.com", "builtin.com",
  "sortlist.com", "designrush.com", "upcity.com", "themanifest.com", "expertise.com", "agencyspotter.com", "consultport.com",
  "upwork.com", "fiverr.com", "toptal.com", "freelancer.com", "peopleperhour.com", "guru.com", "similarweb.com",
  // large software and platform vendors: not small businesses a user can realistically sell to
  "zendesk.com", "salesforce.com", "hubspot.com", "shopify.com", "microsoft.com", "oracle.com", "sap.com", "ibm.com",
  "adobe.com", "intuit.com", "atlassian.com", "slack.com", "zoom.us", "stripe.com", "paypal.com", "twilio.com",
  "mailchimp.com", "godaddy.com", "squarespace.com", "wix.com", "cloudflare.com", "semrush.com", "ahrefs.com",
  "freshworks.com", "zoho.com", "notion.so", "monday.com", "asana.com", "canva.com",
  // marketplaces, booking and delivery platforms
  "amazon.com", "amazon.in", "flipkart.com", "zomato.com", "swiggy.com", "booking.com", "expedia.com", "agoda.com",
  "makemytrip.com", "airbnb.com", "ubereats.com", "doordash.com", "etsy.com", "ebay.com", "alibaba.com",
  // search, big tech, hosted-site builders
  "google.com", "maps.google.com", "bing.com", "apple.com", "wordpress.com", "blogspot.com", "wixsite.com", "weebly.com",
  // news and media
  "forbes.com", "techcrunch.com", "economictimes.indiatimes.com", "businessinsider.com", "bloomberg.com", "reuters.com",
  "nytimes.com", "theguardian.com", "cnn.com", "bbc.com", "bbc.co.uk", "hindustantimes.com", "timesofindia.indiatimes.com",
  "thehindu.com", "indianexpress.com", "ndtv.com", "forbesindia.com", "inc.com", "entrepreneur.com",
];

/** Government, military and school sites are not businesses a user can sell to. */
const NOT_A_BUSINESS_TLD = /(^|\.)(gov|mil|edu)(\.[a-z]{2})?$|(^|\.)(nic\.in|gov\.[a-z]{2}|ac\.[a-z]{2})$/i;

const LISTICLE = /^\s*(top|best|\d+)\s+\d*\s*|\blist of\b|\bbest\b.*\b(companies|agencies|firms|startups)\b|\bvs\.?\b/i;

/** A blog post or guide, not a company's own page: "How to Get Your Product Into Stores", "7 tips for ...". */
const ARTICLE = /^\s*(how|why|what|when|getting|guide|tips)\b|\b(how to|ways to|tips (for|to)|step[- ]by[- ]step|ultimate guide|complete guide|checklist|explained)\b/i;

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function blocked(host: string): boolean {
  return NOT_A_BUSINESS_TLD.test(host) || NOT_A_COMPANY_SITE.some((d) => host === d || host.endsWith(`.${d}`));
}

/** A page title that describes a page or a search, not a company: "Contact Us", "Best Dental Clinic in Chennai". */
const GENERIC_START = /^(contact|home|welcome|about|need help|support|services|our services|blog|menu|log ?in|sign ?in|get in touch|book|appointment|best|top|\d+)\b/i;
const GENERIC_WORDS = /\b(contact|numbers?|reviews?|near me|directory|list of|login|support)\b/i;
// Case-sensitive on purpose: a place name after 'in' is capitalised, so 'Wellness in motion' is not matched.
const PLACE_SUFFIX = /\b(in|near)\s+[A-Z][\w .'-]*$/;
const MAX_NAME = 40;

function isGenericTitle(text: string): boolean {
  return GENERIC_START.test(text) || GENERIC_WORDS.test(text) || PLACE_SUFFIX.test(text);
}

function brandFromHost(host: string): string {
  const label = (host.split(".")[0] ?? host).replace(/[-_]+/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "Acme Clinic | Chennai" -> "Acme Clinic". Falls back to the host's first label when the title is generic or long. */
export function companyNameFrom(title: string, host: string): string {
  const segments = title.split(/\s[|\-–—·]\s|:\s/).map((t) => t.trim()).filter(Boolean);
  const ok = (t: string) => t.length >= 2 && t.length <= MAX_NAME && !isGenericTitle(t);
  // "Ecommerce Customer Service | Zendesk": the brand is the segment that matches the site's own name.
  const label = (host.split(".")[0] ?? host).toLowerCase().replace(/[^a-z0-9]/g, "");
  const brand = label.length >= 3 ? segments.find((t) => ok(t) && t.toLowerCase().replace(/[^a-z0-9]/g, "") === label) : undefined;
  if (brand) return brand;
  const first = segments[0] ?? "";
  if (ok(first)) return first;
  return brandFromHost(host);
}

export type CompanyCandidate = { host: string; website: string; name: string; title: string; snippet: string };

export type PickOptions = {
  /** The user's own site and anything they excluded: never returned. */
  excludeHosts?: readonly string[];
  /** Hosts already saved as leads for this project. */
  knownHosts?: ReadonlySet<string>;
  max?: number;
};

export function pickCompanySites(hits: readonly SearchHit[], opts: PickOptions = {}): CompanyCandidate[] {
  const skip = new Set((opts.excludeHosts ?? []).map((h) => h.toLowerCase().replace(/^www\./, "")));
  const seen = new Set<string>();
  const out: CompanyCandidate[] = [];
  for (const hit of hits) {
    const host = hostOf(hit.url);
    if (!host || blocked(host) || seen.has(host) || skip.has(host) || opts.knownHosts?.has(host)) continue;
    if ([...skip].some((s) => s && host.endsWith(`.${s}`))) continue;
    if (LISTICLE.test(hit.title) || ARTICLE.test(hit.title)) continue;
    seen.add(host);
    out.push({ host, website: `https://${host}/`, name: companyNameFrom(hit.title, host), title: hit.title, snippet: hit.content });
    if (out.length >= (opts.max ?? 12)) break;
  }
  return out;
}
