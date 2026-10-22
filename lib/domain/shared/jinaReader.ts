import { assertPublicHttpUrlResolved, type LookupFn } from "../net/ssrf.ts";

/** Real headless-browser page render via Jina AI Reader (https://r.jina.ai) —
 * no API key required for reasonable volume (20 req/min). Used as a fallback
 * when a plain fetch()+cheerio crawl comes back too thin to be useful, which
 * happens for client-rendered SPAs (React/Vue/Next.js apps with an empty
 * server-rendered shell) — confirmed against a real SPA this session: a
 * plain crawl got 0 chars of body text, Jina with an explicit render wait
 * got the full real page. X-Wait-For-Selector/X-Timeout are what make the
 * difference — Jina's default render is too fast for a slow-hydrating app. */

export type JinaReadResult = { title: string; description: string; url: string; content: string };

/** Hard cap on one Jina render (was 35s). Past this the page simply has no
 * rendered fallback ("not available"), which callers already handle. Jina's own
 * X-Timeout render wait must stay below this so it can answer before we abort. */
export const JINA_TIMEOUT_MS = 15_000;
const JINA_RENDER_WAIT_SECONDS = 12;

export async function jinaRead(url: string, lookup?: LookupFn): Promise<JinaReadResult | null> {
  // The target is handed to a third party, so it must pass the public-address check (DNS included)
  // before anything is sent. The target is URL-encoded so it cannot change the path or query.
  try {
    await assertPublicHttpUrlResolved(url, lookup);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
  try {
    const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      headers: {
        Accept: "application/json",
        "X-Engine": "browser",
        "X-Wait-For-Selector": "body",
        "X-Timeout": String(JINA_RENDER_WAIT_SECONDS),
        // Without this, Jina can serve a stale cached snapshot taken before
        // the SPA finished hydrating — confirmed for real against a live
        // site: cached response had empty content with a warning telling us
        // to opt out of the cache, doing exactly that fixed it.
        "X-No-Cache": "true",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data) return null;
    return {
      title: data.data.title || "",
      description: data.data.description || "",
      url: data.data.url || url,
      content: data.data.content || "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Real internal links pulled from Jina's rendered markdown ([text](url)
 * syntax) — used to seed the multi-page crawl when the plain HTML crawl
 * found none (same SPA situation: no server-rendered <a> tags to extract). */
const ASSET_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|mp4|webm|css|js)$/i;

export function extractMarkdownLinks(markdown: string, baseHost: string): { href: string; text: string }[] {
  const links: { href: string; text: string }[] = [];
  const seen = new Set<string>();
  // Negative lookbehind excludes image syntax (![alt](url)) — without it,
  // Jina's `[![img](imgUrl)caption](pageUrl)` pattern matches the inner
  // image as a false-positive "link", pointing a would-be crawler at a PNG.
  const regex = /(?<!!)\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const [, text, href] = match;
    if (seen.has(href) || ASSET_EXTENSIONS.test(href)) continue;
    try {
      if (new URL(href).hostname.replace(/^www\./, "").toLowerCase() !== baseHost) continue;
    } catch {
      continue;
    }
    seen.add(href);
    links.push({ href, text: text.trim() });
  }
  return links;
}
