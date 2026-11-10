import type { SearchHit } from "../../websearch/searchProvider.ts";

/**
 * Turning web results into candidate COMPANY websites: drop social networks, directories, marketplaces, news
 * and listicles, keep one homepage per company. Pure, so the rules are testable without a network.
 */

const NOT_A_COMPANY_SITE = [
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "pinterest.com", "tiktok.com",
  "reddit.com", "quora.com", "medium.com", "wikipedia.org", "github.com", "substack.com",
  "justdial.com", "indiamart.com", "sulekha.com", "yellowpages.com", "yelp.com", "tripadvisor.com", "trustpilot.com",
  "clutch.co", "g2.com", "capterra.com", "crunchbase.com", "glassdoor.com", "naukri.com", "indeed.com", "goodfirms.co",
  "amazon.com", "amazon.in", "flipkart.com", "google.com", "maps.google.com", "bing.com", "apple.com",
  "wordpress.com", "blogspot.com", "wixsite.com", "forbes.com", "techcrunch.com", "economictimes.indiatimes.com",
];

const LISTICLE = /^\s*(top|best|\d+)\s+\d*\s*|\blist of\b|\bbest\b.*\b(companies|agencies|firms|startups)\b|\bvs\.?\b/i;

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
  return NOT_A_COMPANY_SITE.some((d) => host === d || host.endsWith(`.${d}`));
}

/** "Acme Clinic | Chennai" -> "Acme Clinic". Falls back to the host's first label. */
export function companyNameFrom(title: string, host: string): string {
  const first = title.split(/\s[|\-–—:·]\s/)[0]?.trim() ?? "";
  if (first.length >= 2 && first.length <= 60) return first;
  const label = host.split(".")[0] ?? host;
  return label.charAt(0).toUpperCase() + label.slice(1);
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
    if (LISTICLE.test(hit.title)) continue;
    seen.add(host);
    out.push({ host, website: `https://${host}/`, name: companyNameFrom(hit.title, host), title: hit.title, snippet: hit.content });
    if (out.length >= (opts.max ?? 12)) break;
  }
  return out;
}
