import * as cheerio from "cheerio";
import { jinaRead, extractMarkdownLinks } from "@/lib/domain/shared/jinaReader";
import { assertPublicHostLiteral } from "@/lib/domain/net/ssrf";
import { SafeFetchError } from "../net/safeFetch.ts";
import { extractTitle } from "@/lib/domain/seo/extractTitle";
import { fetchPageSpeed, type CwvSnapshot, type LighthouseIssue } from "@/lib/domain/seo/pageSpeedInsights";
import { checkRobotsTxt, fetchSitePage, SITE_MAX_REDIRECTS, type SitePageFetch } from "./siteFetch.ts";

export type { CwvStatus, CwvMetric, CwvSnapshot } from "@/lib/domain/seo/pageSpeedInsights";

/** Structured findings, additive to `issues` (which stays as-is for the
 * existing Issues list UI). Each carries a stable issueId (used as the
 * code_fixes memory key — same finding on a re-audit maps to the same row,
 * so the fix agent doesn't re-suggest something already PR'd) and an
 * autoFixable flag — true only for single-tag/single-line edits a small LLM
 * patch can make safely without touching rendered content structure. */
export type Finding = {
  issueId: string;
  category: "meta-title" | "meta-description" | "canonical" | "og-tags" | "twitter-tags" | "robots-txt" | "heading-structure" | "lighthouse";
  severity: "Warning" | "Error";
  label: string;
  evidence: Record<string, string | number | null>;
  autoFixable: boolean;
};

export type SEOAuditPayload = {
  url: string;
  meta: {
    title: string;
    description: string;
    canonical?: string;
    robots?: string;
    indexable: boolean;
  };
  headings: {
    h1: number;
    h2: number;
    h3: number;
  };
  openGraph: { key: string; value: string; ok: boolean }[];
  twitter: { key: string; value: string; ok: boolean }[];
  issues: { label: string; level: "Warning" | "Error" }[];
  findings: Finding[];
  /** Undefined (not a fake fallback) when no PageSpeed key is connected, or
   * the real PSI call failed — the frontend shows a real crawl-derived
   * substitute instead of ever presenting invented Lighthouse-shaped numbers. */
  pageSpeed?: {
    desktop: { performance: number; accessibility: number; bestPractices: number; seo: number };
    mobile: { performance: number; accessibility: number; bestPractices: number; seo: number };
  };
  coreWebVitals?: {
    desktop: CwvSnapshot;
    mobile: CwvSnapshot;
  };
  lighthouseIssues?: {
    desktop: LighthouseIssue[];
    mobile: LighthouseIssue[];
  };
  /** Visible page text (script/style stripped, whitespace collapsed, capped
   * at ~6000 chars) — the raw material downstream doc generators (Product
   * Information, Marketing Strategy, ...) ground their output in, instead of
   * inferring content from meta tags alone. Not shown in the SEO UI itself. */
  bodyText: string;
  /** "jina-fallback" when the plain crawl came back too thin to be useful
   * (a client-rendered SPA with an empty server-rendered shell) and Jina's
   * real headless-browser render was used instead — bodyText/links reflect
   * the Jina result in that case, not the raw HTML. */
  contentSource: "crawl" | "jina-fallback";
  /** Real, cheerio-extracted visual signals — no computed styles (would need
   * a headless browser), so every field is optional. The Design Guide
   * generator must say "Not stated on the page" for anything missing here
   * rather than invent it. */
  design: {
    /** From <meta name="theme-color">, if present. */
    themeColor?: string;
    /** Font family names parsed out of Google Fonts <link> hrefs — reliable
     * when present since the URL itself names the font, no guessing. */
    fonts: string[];
    /** Best-effort logo <img> (alt/src/class containing "logo"), resolved to
     * an absolute URL. */
    logoUrl?: string;
    /** <link rel="icon"> / "shortcut icon">, resolved to an absolute URL. */
    faviconUrl?: string;
  };
  /** Real response-level signals — headers + byte counts from the actual
   * crawl response, cheerio element counts. onPageScore is a deterministic
   * "checks passed" percentage over things this crawl can actually verify —
   * not a Lighthouse-equivalent score, just an honest on-page checklist. */
  technical: {
    onPageScore: number;
    server?: string;
    status: number;
    encoding?: string;
    pageSizeBytes: number;
    domSize: number;
    cacheable: boolean;
    /** Real hops followed to reach the final page — 0 means no redirect. */
    redirectCount: number;
    /** Real robots.txt fetch+parse (User-agent: * group only) — whether the
     * file exists at all, and whether it disallows the crawled path. Doesn't
     * block the crawl (this is the owner auditing their own site), just reports it. */
    robotsTxt: { exists: boolean; disallowsThisPage: boolean };
  };
  /** Real network-phase timings from a raw Node http(s) request — connect/TLS/
   * TTFB/download are genuinely measurable server-side. "Time to Interactive"
   * and "DOM Complete" are NOT included here: those are rendering/JS-execution
   * concepts a server-side crawl can't see without a real browser (Core Web
   * Vitals above already covers that, via real Lighthouse data when a
   * PageSpeed key is connected — no point faking a second version of it). */
  serverTiming: {
    connectMs?: number;
    tlsHandshakeMs?: number;
    ttfbMs?: number;
    downloadMs?: number;
  };
  renderBlocking: {
    blockingScripts: number;
    blockingStylesheets: number;
  };
  /** Deterministic keyword-overlap % between meta tags and body text — real
   * and reproducible, not an LLM guess that could vary run to run. */
  contentRelevance: {
    titleRelevance: number;
    descriptionRelevance: number;
    keywordRelevance: number;
  };
  /** Real <a href> links extracted from the crawl — capped, classified
   * internal/external. Reachability is NOT checked here (that's a separate,
   * explicit, bounded action — see /api/agents/links/check — so a routine
   * audit doesn't silently fire dozens of extra requests). */
  links: { href: string; text: string; internal: boolean }[];
};

const REQUIRED_OG_TAGS = ["og:title", "og:description", "og:image"];
const REQUIRED_TWITTER_TAGS = ["twitter:card"];

const CRAWL_TIMEOUT_MS = 10_000;

/** Blocks obvious SSRF targets (localhost, private ranges, link-local, non-http
 * schemes). Not exhaustive DNS-rebinding protection, but stops the easy cases
 * before the server fetches an attacker-supplied URL. */
export function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  // Trailing dots, *.localhost/*.internal/*.local, metadata names and every private, loopback,
  // link-local, CGNAT and ULA IP literal (IPv6 and IPv4-mapped too). DNS is NOT resolved here:
  // use assertPublicHttpUrlResolved (lib/domain/net/ssrf) when the caller can be async.
  try {
    assertPublicHostLiteral(parsed.hostname);
  } catch {
    throw new Error("URLs pointing to local/private addresses are not allowed");
  }

  return parsed;
}

/** Crawl of the page and the robots check live in ./siteFetch.ts (guarded fetcher). */

export class SEOAgent {
  constructor(private pageSpeedApiKey?: string) {}

  async audit(url: string): Promise<SEOAuditPayload> {
    const issues: { label: string; level: "Warning" | "Error" }[] = [];
    const findings: Finding[] = [];

    const validated = assertPublicHttpUrl(url);

    // 1. Crawl URL — bounded by a timeout so a hung/slow target can't stall the
    // request forever. Uses the guarded fetcher (pinned DNS, total deadline) so real
    // connection-phase timing is still available for the Technical tab.
    let crawl: SitePageFetch;
    try {
      crawl = await fetchSitePage(validated, CRAWL_TIMEOUT_MS);
    } catch (e) {
      // The caller gets only the generic public message; the code goes to the server log.
      const publicMessage = e instanceof SafeFetchError ? e.message : "The site could not be reached.";
      console.warn("seo.crawl.failed", e instanceof SafeFetchError ? e.code : "unknown");
      throw new Error(publicMessage);
    }
    if (crawl.status < 200 || crawl.status >= 400) {
      console.warn("seo.crawl.failed", "http-status");
      throw new Error("The site did not return a usable page.");
    }
    const html = crawl.html;

    // Redirect-chain/loop: a single hop (http to https, apex and www) is normal and not
    // worth flagging; 2+ hops or hitting the cap while still 3xx (a loop) is.
    if (crawl.redirectCount >= SITE_MAX_REDIRECTS && crawl.status >= 300 && crawl.status < 400) {
      issues.push({ label: `Redirect loop detected — didn't resolve after ${SITE_MAX_REDIRECTS} hops`, level: "Error" });
    } else if (crawl.redirectCount >= 2) {
      issues.push({ label: `Redirect chain detected (${crawl.redirectCount} hops before reaching the final page)`, level: "Warning" });
    }

    const robotsTxt = await checkRobotsTxt(validated.origin, validated.pathname);
    if (robotsTxt.disallowsThisPage) {
      issues.push({ label: "This page is disallowed by robots.txt for general crawlers", level: "Warning" });
      findings.push({
        issueId: "robots-txt-disallow",
        category: "robots-txt",
        severity: "Warning",
        label: "This page is disallowed by robots.txt for general crawlers",
        evidence: { path: validated.pathname },
        autoFixable: true,
      });
    }

    const $ = cheerio.load(html);

    // Visible text only — strip script/style/noscript before extracting, so
    // downstream doc generation isn't fed JS bundles or CSS as "page content".
    $("script, style, noscript").remove();
    let bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 6000);
    let contentSource: "crawl" | "jina-fallback" = "crawl";

    // A plain crawl gets nothing but an empty shell on client-rendered SPAs
    // (confirmed for real: a React app's server HTML had 0 chars of body
    // text). Fall back to a real headless-browser render via Jina — no key
    // required — only when the plain crawl genuinely came back too thin.
    const MIN_BODY_TEXT_LENGTH = 200;
    let jinaFallback: Awaited<ReturnType<typeof jinaRead>> = null;
    if (bodyText.length < MIN_BODY_TEXT_LENGTH) {
      jinaFallback = await jinaRead(validated.toString());
      if (jinaFallback && jinaFallback.content.trim().length > bodyText.length) {
        bodyText = jinaFallback.content.trim().slice(0, 6000);
        contentSource = "jina-fallback";
      }
    }

    // 2. Parse tags
    const title = extractTitle($);
    const description = $("meta[name='description']").attr("content") || "";
    const canonical = $("link[rel='canonical']").attr("href")?.trim() || undefined;
    const robots = $("meta[name='robots']").attr("content")?.trim() || undefined;
    const indexable = !robots?.split(",").some((directive) => directive.trim().toLowerCase() === "noindex");

    if (!canonical) issues.push({ label: "Missing canonical URL", level: "Warning" });
    if (!indexable) issues.push({ label: "Page is marked noindex", level: "Warning" });

    if (!title) {
      issues.push({ label: "Missing Meta Title", level: "Error" });
      findings.push({
        issueId: "meta-title-missing",
        category: "meta-title",
        severity: "Error",
        label: "Missing Meta Title",
        evidence: { current: null },
        autoFixable: true,
      });
    } else if (title.length > 60) {
      issues.push({ label: "Meta title too long (> 60 chars)", level: "Warning" });
      findings.push({
        issueId: "meta-title-too-long",
        category: "meta-title",
        severity: "Warning",
        label: "Meta title too long (> 60 chars)",
        evidence: { current: title, length: title.length },
        autoFixable: true,
      });
    }

    if (!description) {
      issues.push({ label: "Missing Meta Description", level: "Error" });
      findings.push({
        issueId: "meta-description-missing",
        category: "meta-description",
        severity: "Error",
        label: "Missing Meta Description",
        evidence: { current: null },
        autoFixable: true,
      });
    } else if (description.length > 160) {
      issues.push({ label: "Meta description too long (> 160 chars)", level: "Warning" });
      findings.push({
        issueId: "meta-description-too-long",
        category: "meta-description",
        severity: "Warning",
        label: "Meta description too long (> 160 chars)",
        evidence: { current: description, length: description.length },
        autoFixable: true,
      });
    }

    if (!canonical) {
      issues.push({ label: "Missing canonical tag", level: "Warning" });
      findings.push({
        issueId: "canonical-missing",
        category: "canonical",
        severity: "Warning",
        label: "Missing canonical tag",
        evidence: { current: null, url: validated.toString() },
        autoFixable: true,
      });
    }

    const headings = {
      h1: $("h1").length,
      h2: $("h2").length,
      h3: $("h3").length,
    };

    // Heading findings are visibility-only (autoFixable: false) — fixing them
    // means restructuring real rendered markup, not a single-tag edit, so out
    // of the v1 auto-fix scope even though they're detected here.
    if (headings.h1 === 0) {
      issues.push({ label: "No H1 tag found", level: "Error" });
      findings.push({
        issueId: "heading-h1-missing",
        category: "heading-structure",
        severity: "Error",
        label: "No H1 tag found",
        evidence: { h1Count: 0 },
        autoFixable: false,
      });
    }
    if (headings.h1 > 1) {
      issues.push({ label: "Multiple H1 tags found", level: "Warning" });
      findings.push({
        issueId: "heading-h1-multiple",
        category: "heading-structure",
        severity: "Warning",
        label: "Multiple H1 tags found",
        evidence: { h1Count: headings.h1 },
        autoFixable: false,
      });
    }

    // Heading order — real DOM-order walk, flag the first level skip found
    // (e.g. h1 straight to h3 with no h2 between them). Cheerio returns
    // matches in document order, so this reflects the real page structure.
    let lastLevel = 0;
    let headingOrderOk = true;
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const level = Number(el.tagName?.slice(1));
      if (lastLevel > 0 && level - lastLevel > 1) {
        headingOrderOk = false;
        issues.push({ label: `Heading order skips a level (h${lastLevel} → h${level})`, level: "Warning" });
        findings.push({
          issueId: "heading-order-skip",
          category: "heading-structure",
          severity: "Warning",
          label: `Heading order skips a level (h${lastLevel} → h${level})`,
          evidence: { fromLevel: lastLevel, toLevel: level },
          autoFixable: false,
        });
        lastLevel = level;
        return false; // stop after the first skip — one flag is enough signal
      }
      lastLevel = level;
    });

    const openGraph: { key: string; value: string; ok: boolean }[] = [];
    $("meta[property^='og:']").each((_, el) => {
      const prop = $(el).attr("property");
      const content = $(el).attr("content");
      if (prop && content) openGraph.push({ key: prop, value: content, ok: true });
    });
    const missingOg = REQUIRED_OG_TAGS.filter((tag) => !openGraph.some((t) => t.key === tag));
    if (openGraph.length === 0) {
      issues.push({ label: "Missing Open Graph tags", level: "Warning" });
      findings.push({
        issueId: "og-tags-missing",
        category: "og-tags",
        severity: "Warning",
        label: "Missing Open Graph tags",
        evidence: { missing: REQUIRED_OG_TAGS.join(", ") },
        autoFixable: true,
      });
    } else if (missingOg.length > 0) {
      issues.push({ label: `Missing required OG tags: ${missingOg.join(", ")}`, level: "Warning" });
      findings.push({
        issueId: "og-tags-partial",
        category: "og-tags",
        severity: "Warning",
        label: `Missing required OG tags: ${missingOg.join(", ")}`,
        evidence: { missing: missingOg.join(", "), present: openGraph.map((t) => t.key).join(", ") },
        autoFixable: true,
      });
    }

    const twitter: { key: string; value: string; ok: boolean }[] = [];
    $("meta[name^='twitter:']").each((_, el) => {
      const name = $(el).attr("name");
      const content = $(el).attr("content");
      if (name && content) twitter.push({ key: name, value: content, ok: true });
    });
    const missingTwitter = REQUIRED_TWITTER_TAGS.filter((tag) => !twitter.some((t) => t.key === tag));
    if (missingTwitter.length > 0) {
      issues.push({ label: `Missing required Twitter card tags: ${missingTwitter.join(", ")}`, level: "Warning" });
      findings.push({
        issueId: "twitter-tags-missing",
        category: "twitter-tags",
        severity: "Warning",
        label: `Missing required Twitter card tags: ${missingTwitter.join(", ")}`,
        evidence: { missing: missingTwitter.join(", "), present: twitter.map((t) => t.key).join(", ") },
        autoFixable: true,
      });
    }

    // 3. PageSpeed — real call only if a key is configured. No mock fallback:
    // undefined here means "not available," and the frontend shows a real
    // crawl-derived substitute instead of ever inventing Lighthouse-shaped
    // numbers (a hardcoded 80/90/100/90 for every site is a lie dressed up
    // as data, even with a disclosure banner next to it).
    let pageSpeedScores: SEOAuditPayload["pageSpeed"];
    let vitals: SEOAuditPayload["coreWebVitals"];
    let lighthouseIssues: SEOAuditPayload["lighthouseIssues"];

    if (this.pageSpeedApiKey) {
      try {
        const result = await fetchPageSpeed(url, this.pageSpeedApiKey);
        pageSpeedScores = result.pageSpeed;
        vitals = result.coreWebVitals;
        lighthouseIssues = result.lighthouseIssues;

        // Promote the highest-signal Lighthouse problems into the same
        // findings pipeline as on-page SEO issues. Keep this intentionally
        // small: users need a focused list, not every Lighthouse audit row.
        if (lighthouseIssues) {
          const candidates = [
            ...lighthouseIssues.mobile.map((issue) => ({ ...issue, device: "mobile" as const })),
            ...lighthouseIssues.desktop.map((issue) => ({ ...issue, device: "desktop" as const })),
          ]
            .filter((issue) => issue.mode === "opportunity" || (issue.score !== null && issue.score < 0.5))
            .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
            .slice(0, 6);

          for (const issue of candidates) {
            findings.push({
              issueId: `lighthouse-${issue.device}-${issue.id}`,
              category: "lighthouse",
              severity: issue.score !== null && issue.score < 0.5 ? "Error" : "Warning",
              label: issue.title,
              evidence: {
                device: issue.device,
                mode: issue.mode,
                score: issue.score,
                displayValue: issue.displayValue ?? null,
                auditId: issue.id,
              },
              autoFixable: false,
            });
          }
        }
      } catch (e) {
        console.warn("Failed to fetch real PageSpeed Insights data.", e);
        issues.push({ label: "Failed to fetch PageSpeed Insights data — Performance/CWV not available this run", level: "Warning" });
      }
    }

    // 4. Design tokens — real signals only, from the same crawl, no second
    // fetch. Cheap (cheerio, no headless browser), so coverage is partial by
    // nature: reliable when the page uses Google Fonts / a theme-color meta
    // tag / an obviously-labeled logo image, silently absent otherwise.
    const resolveUrl = (raw: string | undefined): string | undefined => {
      if (!raw) return undefined;
      try {
        return new URL(raw, validated).toString();
      } catch {
        return undefined;
      }
    };

    const themeColor = $("meta[name='theme-color']").attr("content")?.trim() || undefined;

    const fonts = new Set<string>();
    $("link[href*='fonts.googleapis.com']").each((_, el) => {
      const href = $(el).attr("href");
      const fontUrl = resolveUrl(href);
      if (!fontUrl) return;
      try {
        for (const raw of new URL(fontUrl).searchParams.getAll("family")) {
          for (const entry of raw.split("|")) {
            const name = entry.split(":")[0].replace(/\+/g, " ").trim();
            if (name) fonts.add(name);
          }
        }
      } catch {
        // malformed font URL — skip
      }
    });

    let logoUrl: string | undefined;
    $("img").each((_, el) => {
      if (logoUrl) return;
      const alt = ($(el).attr("alt") || "").toLowerCase();
      const src = ($(el).attr("src") || "").toLowerCase();
      const cls = ($(el).attr("class") || "").toLowerCase();
      if (alt.includes("logo") || src.includes("logo") || cls.includes("logo")) {
        logoUrl = resolveUrl($(el).attr("src"));
      }
    });

    const faviconUrl = resolveUrl(
      $("link[rel='icon']").attr("href") || $("link[rel='shortcut icon']").attr("href")
    );

    // 5. Technical signals — real response headers/bytes + cheerio counts.
    const headerValue = (v: string | string[] | undefined): string | undefined =>
      Array.isArray(v) ? v[0] : v;

    const server = headerValue(crawl.headers.server);
    const encoding = headerValue(crawl.headers["content-encoding"]);
    const cacheControl = headerValue(crawl.headers["cache-control"]) || "";
    const cacheable = !!cacheControl && !/no-store|no-cache|private/i.test(cacheControl);
    const pageSizeBytes = Buffer.byteLength(html, "utf8");
    const domSize = $("*").length;

    // On-Page Score — a deterministic % of real checks passed, not a
    // Lighthouse-style number. Every check here mirrors something already
    // computed above (title/description length, single H1, OG/Twitter presence).
    // Must cover every finding category SEOAgent can surface for this page —
    // a category that's flagged as a finding but excluded here produces a
    // contradiction a stranger will immediately distrust: 100/100 next to an
    // active warning (confirmed on a real site: canonical-missing scored 100).
    const onPageChecks = [
      !!title && title.length <= 60,
      !!description && description.length <= 160,
      !!canonical,
      headings.h1 === 1,
      headingOrderOk,
      openGraph.length > 0 && missingOg.length === 0,
      twitter.length > 0 && missingTwitter.length === 0,
      !robotsTxt.disallowsThisPage,
      cacheable,
    ];
    const onPageScore = Math.round((onPageChecks.filter(Boolean).length / onPageChecks.length) * 100);

    // 6. Render-blocking — scripts/stylesheets in <head> without async/defer/module.
    let blockingScripts = 0;
    $("head script").each((_, el) => {
      const type = ($(el).attr("type") || "").toLowerCase();
      if (!$(el).attr("async") && !$(el).attr("defer") && type !== "module") blockingScripts++;
    });
    let blockingStylesheets = 0;
    $("head link[rel='stylesheet']").each((_, el) => {
      const media = ($(el).attr("media") || "").toLowerCase();
      if (media !== "print") blockingStylesheets++;
    });

    // 7. Content relevance — deterministic keyword-overlap, not an LLM guess
    // that could vary run to run.
    const STOPWORDS = new Set([
      "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with",
      "your", "you", "is", "are", "it", "this", "that", "at", "by", "from",
      "as", "be", "was", "were", "will", "can", "our",
    ]);
    const tokenize = (text: string): string[] =>
      (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2 && !STOPWORDS.has(t));
    const bodyTokens = new Set(tokenize(bodyText));
    const relevanceOf = (text: string): number => {
      const tokens = tokenize(text);
      if (tokens.length === 0) return 0;
      const matched = tokens.filter((t) => bodyTokens.has(t)).length;
      return Math.round((matched / tokens.length) * 100);
    };
    const contentRelevance = {
      titleRelevance: relevanceOf(title),
      descriptionRelevance: relevanceOf(description),
      keywordRelevance: relevanceOf(`${title} ${description}`),
    };

    // 8. Links — capped, classified internal/external. No reachability check
    // here — that's a separate, explicit, bounded action (see
    // /api/agents/links/check) so a routine audit doesn't silently fire
    // dozens of extra requests.
    const links: { href: string; text: string; internal: boolean }[] = [];
    const seenHrefs = new Set<string>();
    $("a[href]").each((_, el) => {
      if (links.length >= 50) return;
      const resolved = resolveUrl($(el).attr("href"));
      if (!resolved || seenHrefs.has(resolved) || !resolved.startsWith("http")) return;
      seenHrefs.add(resolved);
      let internal = false;
      try {
        internal = new URL(resolved).hostname === validated.hostname;
      } catch {
        // unresolvable — treat as external
      }
      links.push({ href: resolved, text: $(el).text().trim().slice(0, 80), internal });
    });

    // Same SPA situation as bodyText — no server-rendered <a> tags to find.
    // Jina's rendered markdown has real internal links; use those instead of
    // reporting zero.
    if (links.length === 0 && jinaFallback) {
      for (const l of extractMarkdownLinks(jinaFallback.content, validated.hostname)) {
        if (links.length >= 50) break;
        links.push({ href: l.href, text: l.text.slice(0, 80), internal: true });
      }
    }

    return {
      url,
      meta: { title, description, canonical, robots, indexable },
      headings,
      openGraph,
      twitter,
      issues,
      findings,
      pageSpeed: pageSpeedScores,
      coreWebVitals: vitals,
      lighthouseIssues,
      bodyText,
      contentSource,
      design: { themeColor, fonts: Array.from(fonts), logoUrl, faviconUrl },
      technical: { onPageScore, server, status: crawl.status, encoding, pageSizeBytes, domSize, cacheable, redirectCount: crawl.redirectCount, robotsTxt },
      serverTiming: crawl.timing,
      renderBlocking: { blockingScripts, blockingStylesheets },
      contentRelevance,
      links,
    };
  }
}
