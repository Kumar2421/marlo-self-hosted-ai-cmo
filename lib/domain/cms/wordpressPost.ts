import { CmsError } from "./cmsFixCatalog.ts";
import { cmsFetch, type CmsFetchOptions } from "./cmsFetch.ts";

/**
 * Publishes one WordPress post through the guarded CMS fetch: pinned DNS, same-host redirects only,
 * Authorization never leaves the connected host. Upstream bodies are never echoed to the caller.
 */

export type WordPressPostInput = { baseUrl: string; credentials: string; title: string; html: string };

/** Accepts only an http(s) link on the connected host. Anything else is stored as null. */
export function sameHostLink(link: unknown, baseUrl: string): string | null {
  if (typeof link !== "string") return null;
  try {
    const u = new URL(link);
    const base = new URL(baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.hostname.toLowerCase() !== base.hostname.toLowerCase()) return null;
    return link;
  } catch {
    return null;
  }
}

export async function publishWordPressPost(input: WordPressPostInput, net: CmsFetchOptions): Promise<{ publishedUrl: string | null }> {
  const base = input.baseUrl.replace(/\/+$/, "");
  const res = await cmsFetch(
    `${base}/wp-json/wp/v2/posts`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(input.credentials).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "MarloBot/1.0",
      },
      body: JSON.stringify({ title: input.title, content: input.html, status: "publish" }),
    },
    net,
  );
  if (!res.ok) throw new CmsError(`WordPress rejected the post (HTTP ${res.status}).`, 422);
  let data: { link?: unknown } | null = null;
  try {
    data = res.json() as { link?: unknown } | null;
  } catch {
    // The post may be live even when the reply is not JSON; the link is then simply unknown.
  }
  return { publishedUrl: sameHostLink(data?.link, base) };
}
