/**
 * Default project name derivation. Pure, no dependencies.
 *
 * A bare hostname label is a bad name for "home.mlforge.in" ("Home") because
 * subdomains like home/www/app say nothing about the business. Preference order:
 *   1. og:site_name from the crawled page
 *   2. the brand segment of the <title> ("Acme | Invoicing" -> "Acme")
 *   3. the registrable-domain label ("mlforge" from home.mlforge.in), title-cased
 * A name the user typed is never touched (see decideAutoRename).
 */

/** Hostname labels / title words that name a part of a site, not a business. */
const GENERIC_LABELS = new Set([
  "home", "homepage", "www", "www2", "app", "apps", "web", "site", "website", "my", "portal", "en", "m", "mobile",
  "blog", "docs", "doc", "shop", "store", "welcome", "index", "main", "login", "signin", "dashboard", "online",
  "official", "untitled", "default", "staging", "dev", "test", "beta", "cdn", "static", "api", "admin", "help",
  "support", "news", "careers", "about", "landing", "get", "go", "try", "us", "uk", "de", "fr", "es", "in",
]);

/** Second-level labels that form a public suffix with a ccTLD (co.uk, com.au, co.in ...). */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ne", "or", "go", "nic", "mil"]);

export function isGenericLabel(value: string): boolean {
  const v = value.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
  if (!v) return true;
  if (GENERIC_LABELS.has(v)) return true;
  return v.split(" ").every((w) => GENERIC_LABELS.has(w));
}

// --- minimal punycode decode (RFC 3492) so "xn--mnchen-3ya" shows as "münchen" ---
function punycodeDecode(input: string): string {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  const out: number[] = [];
  let n = 128, i = 0, bias = 72;
  let basic = input.lastIndexOf("-");
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) out.push(input.charCodeAt(j));
  const adapt = (delta: number, numPoints: number, first: boolean) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) throw new Error("bad punycode");
      const c = input.charCodeAt(idx++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
      if (digit >= base) throw new Error("bad punycode");
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    const len = out.length + 1;
    bias = adapt(i - oldi, len, oldi === 0);
    n += Math.floor(i / len);
    i %= len;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

function decodeLabel(label: string): string {
  if (!label.startsWith("xn--")) return label;
  try {
    return punycodeDecode(label.slice(4));
  } catch {
    return label;
  }
}

export function hostOf(url: string): string {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    return u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** The label that identifies the business: "mlforge" for home.mlforge.in, "acme" for www.acme.co.uk. */
export function registrableLabel(host: string): string {
  const labels = host.replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length === 0) return "";
  if (labels.length === 1) return decodeLabel(labels[0]);
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  // co.uk, com.au, co.in ...: the business label sits one position further left.
  const twoLevel = tld.length === 2 && SECOND_LEVEL.has(sld) && labels.length >= 3;
  const idx = labels.length - (twoLevel ? 3 : 2);
  return decodeLabel(labels[idx]);
}

function titleCase(label: string): string {
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1))
    .join(" ");
}

/** Name from the URL alone (what the client can know before the crawl). */
export function deriveNameFromUrl(url: string): string {
  const host = hostOf(url);
  if (!host) return url.trim();
  const label = registrableLabel(host);
  return label ? titleCase(label) : host;
}

/** The old behaviour (first hostname label), kept to recognise names created before this fix. */
export function legacyNameFromUrl(url: string): string {
  const host = hostOf(url).replace(/^www\./, "");
  const base = host.split(".")[0] ?? "";
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : url.trim();
}

const MAX_BRAND_LEN = 40;

function usableBrand(value: string | undefined | null): string | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v || v.length > MAX_BRAND_LEN || isGenericLabel(v)) return null;
  return v;
}

/** The brand part of a page title: "Acme | Invoicing" -> "Acme"; "Home - MLForge Studio" -> "MLForge Studio". */
export function brandFromTitle(title: string | undefined | null): string | null {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const parts = t.split(/\s+[|\-–—·•:]\s+|\s*[|·•]\s*/).map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    const brand = usableBrand(p);
    if (brand) return brand;
  }
  return null;
}

export type NameSources = { url: string; siteName?: string | null; title?: string | null };

export function pickProjectName({ url, siteName, title }: NameSources): string {
  return usableBrand(siteName) ?? brandFromTitle(title) ?? deriveNameFromUrl(url);
}

/** True when `name` is one of the names the app would have generated itself for this URL. */
export function isAutoDerivedName(name: string, url: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  return n === deriveNameFromUrl(url).toLowerCase() || n === legacyNameFromUrl(url).toLowerCase();
}

export type AuditNameSignals = {
  meta?: { title?: string | null };
  openGraph?: { key: string; value: string }[];
};

/**
 * After the crawl: the better name to rename to, or null to leave the project alone.
 * Only an auto-derived current name is ever replaced, never one the user typed or edited.
 */
export function decideAutoRename(currentName: string, url: string, audit: AuditNameSignals | null | undefined): string | null {
  if (!audit || !isAutoDerivedName(currentName, url)) return null;
  const siteName = audit.openGraph?.find((t) => t.key === "og:site_name")?.value;
  const next = pickProjectName({ url, siteName, title: audit.meta?.title });
  return next && next !== currentName.trim() ? next : null;
}
