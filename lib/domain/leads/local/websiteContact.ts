import * as cheerio from "cheerio";
import { assertPublicHttpUrlResolved, type LookupFn } from "../../net/ssrf.ts";

/**
 * Public contact details from a business website: emails, a WhatsApp number, the contact page
 * and a short description. extractContact is pure (HTML in, facts out). enrichBusiness does the
 * fetching: homepage plus at most two same-site pages, every hop SSRF-checked with DNS resolution,
 * no cookies, text/html only, a byte cap per page, and it never throws.
 */

export type ContactExtract = {
  emails: string[];
  whatsapp: string | null;
  contactUrl: string | null;
  description: string | null;
};

export type EnrichmentStatus = "ok" | "no_website" | "blocked" | "failed";

export type Enrichment = ContactExtract & { status: EnrichmentStatus };

export type EnrichDeps = {
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
  timeoutMs?: number;
};

export const MAX_PAGE_BYTES = 400_000;
export const MAX_REDIRECTS = 3;
export const PAGE_TIMEOUT_MS = 6_000;
/** Homepage plus at most this many extra same-site pages. */
export const MAX_EXTRA_PAGES = 2;
const MAX_EMAILS = 3;
const MAX_EMAIL_LENGTH = 80;
const MAX_DESCRIPTION = 200;
const USER_AGENT = "Mozilla/5.0 (compatible; OkaraLeadBot/1.0; +https://okara.ai)";

// The lookbehind anchors the match to a token start, so an over-long local part is not cut down to a shorter one.
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}/g;
const JUNK_EXTENSION = /\.(png|jpe?g|gif|webp|svg|ico|css|js|woff2?)$/i;
const JUNK_DOMAIN = /((^|\.)(sentry\.io|wixpress\.com)$|^(example\.(com|org|net)|yourdomain\.[a-z]+|domain\.com)$)/i;
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster)$/i;
const WHATSAPP_RE = /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?[^#]*?phone=|whatsapp:\/\/send\?[^#]*?phone=)\+?(\d{8,15})(?!\d)/i;
const CONTACT_RE = /contact|get in touch|reach us/i;
const ABOUT_RE = /about/i;
const GENERIC_DESCRIPTION = /cookie|javascript|enable js/i;

function normHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function sameSite(a: string, b: string): boolean {
  try {
    return normHost(new URL(a).hostname) === normHost(new URL(b).hostname);
  } catch {
    return false;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Own-domain addresses first, then the rest. Drops junk, dedupes, keeps MAX_EMAILS. */
export function rankEmails(candidates: string[], siteHost: string): string[] {
  const host = normHost(siteHost);
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of candidates) {
    const email = raw.trim().toLowerCase().replace(/\.+$/, "");
    if (!email || email.length > MAX_EMAIL_LENGTH || seen.has(email)) continue;
    const at = email.lastIndexOf("@");
    if (at < 1) continue;
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (JUNK_EXTENSION.test(email) || JUNK_DOMAIN.test(domain) || JUNK_LOCAL.test(local)) continue;
    seen.add(email);
    clean.push(email);
  }
  const own = (e: string) => {
    const d = e.slice(e.lastIndexOf("@") + 1);
    return d === host || d.endsWith(`.${host}`);
  };
  return [...clean.filter(own), ...clean.filter((e) => !own(e))].slice(0, MAX_EMAILS);
}

// Bracketed forms are explicit obfuscation, so they are unobfuscated anywhere.
const BRACKET_AT_RE = /([A-Za-z0-9._%+-]{1,64})\s{0,4}(?:\[at\]|\(at\))\s{0,4}([A-Za-z0-9-]{1,63})\s{0,4}(?:\[dot\]|\(dot\)|\.)\s{0,4}([A-Za-z]{2,24})/gi;
// Spelled-out "name at domain dot com" is ordinary prose ("ask Jane at Acme dot com"), so it is
// unobfuscated only right after a contact label such as "email:" or "contact".
const LABELLED_WORD_AT_RE = /((?:e-?mail|mail|contact)\s{0,4}:?\s{0,4})([A-Za-z0-9._%+-]{1,64})\s{1,4}at\s{1,4}([A-Za-z0-9-]{1,63})\s{1,4}dot\s{1,4}([A-Za-z]{2,24})/gi;

/**
 * Unobfuscate only explicit forms: "name [at] domain [dot] com" and "(at)"/"(dot)", or a spelled
 * "name at domain dot com" directly after a contact label. Bounded quantifiers only: unbounded
 * ones backtrack quadratically on long runs of word characters.
 */
function deobfuscate(text: string): string {
  return text.replace(BRACKET_AT_RE, "$1@$2.$3").replace(LABELLED_WORD_AT_RE, "$1$2@$3.$4");
}

function extractWhatsapp($: cheerio.CheerioAPI): string | null {
  let found: string | null = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const href = safeDecode($(el).attr("href") ?? "");
    const m = WHATSAPP_RE.exec(href);
    if (m) found = m[1];
  });
  return found;
}

function extractContactUrl($: cheerio.CheerioAPI, base: URL): string | null {
  const candidates: { url: string; rank: number }[] = [];
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    if (!sameSite(u.toString(), base.toString())) return;
    u.hash = "";
    if (u.pathname === "/" || u.pathname === "") return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const hay = `${href} ${text}`;
    const rank = CONTACT_RE.test(hay) ? 2 : ABOUT_RE.test(hay) ? 1 : 0;
    if (rank > 0) candidates.push({ url: u.toString(), rank });
  });
  candidates.sort((a, b) => b.rank - a.rank);
  return candidates[0]?.url ?? null;
}

function extractDescription($: cheerio.CheerioAPI): string | null {
  const raws = [
    $('meta[name="description"]').attr("content"),
    $('meta[property="og:description"]').attr("content"),
  ];
  for (const raw of raws) {
    const text = (raw ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 10 || GENERIC_DESCRIPTION.test(text)) continue;
    if (text.length <= MAX_DESCRIPTION) return text;
    return `${text.slice(0, MAX_DESCRIPTION - 3).replace(/\s+\S*$/, "")}...`;
  }
  return null;
}

/** Pure: facts from one page's HTML. Never throws. */
export function extractContact(html: string, baseUrl: string): ContactExtract {
  const empty: ContactExtract = { emails: [], whatsapp: null, contactUrl: null, description: null };
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return empty;
  }
  try {
    const $ = cheerio.load(html);
    const mailto: string[] = [];
    $('a[href^="mailto:" i]').each((_, el) => {
      const raw = safeDecode(($(el).attr("href") ?? "").slice(7).split("?")[0]).trim();
      if (raw) mailto.push(raw);
    });
    const whatsapp = extractWhatsapp($);
    const contactUrl = extractContactUrl($, base);
    const description = extractDescription($);

    $("script, style, noscript, template").remove();
    // Block-level boundaries become spaces so adjacent elements never fuse into one token.
    const BLOCKS = "p, div, li, br, td, th, tr, h1, h2, h3, h4, h5, h6, section, article, header, footer, nav, address, ul, ol, table";
    $(BLOCKS).before(" ").after(" ");
    const visible = deobfuscate($("body").text() || $.root().text());
    const textEmails = visible.match(EMAIL_RE) ?? [];

    return {
      emails: rankEmails([...mailto, ...textEmails], base.hostname),
      whatsapp,
      contactUrl,
      description,
    };
  } catch {
    return empty;
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // already closed
  }
  const all = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    const piece = c.subarray(0, Math.max(0, all.length - offset));
    all.set(piece, offset);
    offset += piece.length;
  }
  return new TextDecoder("utf-8").decode(all);
}

type PageFetch = { kind: "ok"; url: string; html: string } | { kind: "blocked" } | { kind: "failed" };

async function cancelBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // ignore
  }
}

/**
 * One guarded GET: every hop is checked, redirects stay on the same site, no cookies are sent.
 * Each hop's DNS check is bounded (LOOKUP_TIMEOUT_MS). The connect fetch() makes after the check
 * can still re-resolve the name; see the residual-window note in assertResolvesPublic.
 */
async function fetchPage(start: string, deps: EnrichDeps): Promise<PageFetch> {
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? PAGE_TIMEOUT_MS;
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      await assertPublicHttpUrlResolved(current, deps.lookup);
    } catch {
      return { kind: "blocked" };
    }
    let res: Response;
    try {
      res = await doFetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { kind: "failed" };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await cancelBody(res);
      if (!location) return { kind: "failed" };
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return { kind: "failed" };
      }
      if (!sameSite(next, start)) return { kind: "failed" };
      current = next;
      continue;
    }
    if (!res.ok) {
      await cancelBody(res);
      return { kind: "failed" };
    }
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      await cancelBody(res);
      return { kind: "failed" };
    }
    const html = await readCapped(res, MAX_PAGE_BYTES);
    return { kind: "ok", url: current, html };
  }
  return { kind: "failed" };
}

function normalizeWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Enrich one business from its website. Never throws. Status:
 * no_website (none listed), blocked (address refused by the SSRF guard), failed (unreachable,
 * not HTML, or malformed), ok (homepage read; contact facts may still be empty).
 */
export async function enrichBusiness(website: string | null, deps: EnrichDeps = {}): Promise<Enrichment> {
  const withStatus = (status: EnrichmentStatus): Enrichment => ({ status, emails: [], whatsapp: null, contactUrl: null, description: null });
  try {
    if (!website || !website.trim()) return withStatus("no_website");
    const start = normalizeWebsite(website);
    if (!start) return withStatus("failed");

    const home = await fetchPage(start, deps);
    if (home.kind === "blocked") return withStatus("blocked");
    if (home.kind === "failed") return withStatus("failed");

    const first = extractContact(home.html, home.url);
    const extraUrls: string[] = [];
    for (const candidate of [first.contactUrl, new URL("/contact", home.url).toString()]) {
      if (!candidate || extraUrls.length >= MAX_EXTRA_PAGES) continue;
      if (candidate === home.url || extraUrls.includes(candidate)) continue;
      if (!sameSite(candidate, home.url)) continue;
      extraUrls.push(candidate);
    }

    const emails = [...first.emails];
    let whatsapp = first.whatsapp;
    let description = first.description;
    let contactUrl = first.contactUrl;
    for (const url of extraUrls) {
      const page = await fetchPage(url, deps);
      if (page.kind !== "ok") continue;
      const more = extractContact(page.html, page.url);
      emails.push(...more.emails);
      whatsapp = whatsapp ?? more.whatsapp;
      description = description ?? more.description;
      contactUrl = contactUrl ?? page.url;
    }

    return {
      status: "ok",
      emails: rankEmails(emails, new URL(home.url).hostname),
      whatsapp,
      contactUrl,
      description,
    };
  } catch {
    return withStatus("failed");
  }
}
