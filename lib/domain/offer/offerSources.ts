import type { SeedLink } from "./keyPages.ts";
import { pickKeyPageLinks } from "./keyPages.ts";
import type { SourceText } from "./offerModel.ts";

/** The parts of a stored SEO audit the Offer Model reads. */
export type AuditForOffer = {
  url: string;
  finalUrl?: string;
  meta: { title: string; description: string };
  bodyText: string;
  links?: SeedLink[];
};

export type CrawledForOffer = { url: string; content: string };
export type CrawlFn = (links: { href: string }[]) => Promise<CrawledForOffer[]>;

/** Key pages are a bonus: past this the homepage text alone is used. Keeps the route inside the 60s function limit. */
export const KEY_PAGES_BUDGET_MS = 15_000;
export const KEY_PAGES_MAX = 3;

function homepageText(audit: AuditForOffer): string {
  return [audit.meta.title, audit.meta.description, audit.bodyText].map((s) => (s ?? "").trim()).filter(Boolean).join("\n");
}

/**
 * Text the Offer Model may quote: the audited homepage, plus up to KEY_PAGES_MAX pricing / services / about /
 * customer pages. A slow or failing crawl never fails the step; the homepage is always returned when it has text.
 */
export async function gatherOfferSources(
  audit: AuditForOffer,
  crawl: CrawlFn,
  budgetMs: number = KEY_PAGES_BUDGET_MS,
): Promise<SourceText[]> {
  const siteUrl = audit.finalUrl || audit.url;
  const sources: SourceText[] = [];
  const home = homepageText(audit);
  if (home) sources.push({ url: siteUrl, text: home });

  const links = pickKeyPageLinks(siteUrl, audit.links ?? [], KEY_PAGES_MAX);
  if (links.length === 0) return sources;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pages = await Promise.race([
      crawl(links.map((href) => ({ href }))),
      new Promise<CrawledForOffer[]>((resolve) => {
        timer = setTimeout(() => resolve([]), budgetMs);
      }),
    ]);
    for (const page of pages) {
      const text = (page.content ?? "").trim();
      if (text) sources.push({ url: page.url, text });
    }
  } catch {
    // The key pages are optional; the homepage text is enough to try.
  } finally {
    if (timer) clearTimeout(timer);
  }
  return sources;
}
