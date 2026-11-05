/**
 * Which internal pages of a site say who the offer is for. The homepage alone often does not: pricing,
 * services, about, customer and industry pages do. Pure: scores links by path and link text only.
 */

export type SeedLink = { href: string; text?: string; internal?: boolean };

const SIGNALS: { pattern: RegExp; weight: number }[] = [
  { pattern: /pricing|plans?\b/i, weight: 5 },
  { pattern: /services?|solutions?|products?|offerings?|what-we-do|capabilities/i, weight: 4 },
  { pattern: /customers?|clients?|case-stud|success-stor|industries|use-cases?|who-we|for-(?!free)/i, weight: 4 },
  { pattern: /about|company|team|story/i, weight: 3 },
  { pattern: /features?/i, weight: 2 },
];

const SKIP = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|css|js)(\?|$)|\/(login|signup|sign-in|sign-up|logout|cart|checkout|privacy|terms|cookie|legal)\b/i;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function scoreOf(href: string, text: string): number {
  let path = "";
  try {
    path = new URL(href).pathname;
  } catch {
    return 0;
  }
  let best = 0;
  for (const s of SIGNALS) if (s.pattern.test(path) || s.pattern.test(text)) best = Math.max(best, s.weight);
  return best;
}

/**
 * Up to `max` same-site links worth reading, highest signal first. The homepage, anchors, assets and
 * account pages are never returned. Ties keep the order the links appear in.
 */
export function pickKeyPageLinks(siteUrl: string, links: readonly SeedLink[], max = 3): string[] {
  const site = hostOf(siteUrl);
  if (!site) return [];
  const seen = new Set<string>();
  const scored: { href: string; score: number; index: number }[] = [];
  links.forEach((link, index) => {
    if (!link.href || SKIP.test(link.href)) return;
    if (link.internal === false) return;
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || hostOf(link.href) !== site) return;
    url.hash = "";
    const clean = url.toString();
    const path = url.pathname.replace(/\/+$/, "");
    // One page however it is linked: with or without www, a trailing slash or a fragment.
    const key = `${hostOf(clean)}${path}${url.search}`;
    if (path === "" || seen.has(key)) return;
    seen.add(key);
    const score = scoreOf(clean, link.text ?? "");
    if (score > 0) scored.push({ href: clean, score, index });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, max))
    .map((s) => s.href);
}
