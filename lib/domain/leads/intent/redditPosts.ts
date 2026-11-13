/**
 * Reddit post helpers for "requests": public posts where someone asks for what the user sells. Pure, so the rules are
 * unit-tested. Marlo never posts to Reddit: it finds the post and drafts a reply the user posts from their own account.
 */

const POST_PATH = /^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{5,10})(?:\/[^/?#]*)?\/?$/;

function redditUrl(url: string | null | undefined): URL | null {
  try {
    const u = new URL((url ?? "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host === "reddit.com" || host === "old.reddit.com" || host === "new.reddit.com" ? u : null;
  } catch {
    return null;
  }
}

/** A link to one Reddit post, not a subreddit page, a search or a feed. */
export function isRedditPostUrl(url: string | null | undefined): boolean {
  const u = redditUrl(url);
  return Boolean(u && POST_PATH.test(u.pathname));
}

export function subredditOf(url: string | null | undefined): string | null {
  const u = redditUrl(url);
  const m = u ? POST_PATH.exec(u.pathname) : null;
  return m ? m[1] : null;
}

/** One address per post, whichever Reddit host or slug the search returned. Null when it is not a post. */
export function canonicalPostUrl(url: string | null | undefined): string | null {
  const u = redditUrl(url);
  const m = u ? POST_PATH.exec(u.pathname) : null;
  return m ? `https://www.reddit.com/r/${m[1]}/comments/${m[2]}/` : null;
}

/** Search results title posts "Title : r/sub" or "Title - Reddit"; the bare title is what a person wrote. */
export function cleanPostTitle(title: string): string {
  return title.replace(/\s*[:|\-–—]\s*r\/[A-Za-z0-9_]+\s*$/, "").replace(/\s*[|\-–—]\s*Reddit\s*$/i, "").replace(/\s+/g, " ").trim();
}

/**
 * Titles that sell, announce, look for clients or jobs, or ask how to start a business. Dropped before any model call:
 * they are not buyers, and they would fill the slots a model can look at. Tuned on real search results, so it is
 * deliberately not exhaustive; the model makes the final call.
 */
const SELLER_TITLE = new RegExp(
  [
    String.raw`\[?for hire\]?`,
    String.raw`\[?hiring\]?`,
    String.raw`i(?:'m| am) an? (?:freelance|freelancer|developer|designer|web|software|consultant|accountant|bookkeeper)`,
    String.raw`i (?:build|offer|made|built|created|launched|can help)`,
    String.raw`we (?:build|offer|help|redesigned)`,
    String.raw`(?:offering|affordable|helping (?:local |small )?business)`,
    String.raw`sales partners?`,
    String.raw`anyone need`,
    String.raw`need clients`,
    String.raw`(?:get|find|finding|land|win|attract)\w*\s+(?:\d+\s+|my\s+|more\s+|good\s+|first\s+|new\s+)?(?:[\w-]+\s+){0,3}clients?`,
    String.raw`how did you (?:land|find|get)`,
    String.raw`how (?:do|would) you find`,
    String.raw`looking for (?:\S+\s+){0,5}(?:clients|jobs?|opportunities|work)\b`,
    String.raw`(?:started|starting|planning to start|start) an? [\w\s-]{0,40}business`,
    String.raw`cold emailing`,
    String.raw`refer business`,
  ].join("|"),
  "i",
);

export function looksLikeSeller(title: string): boolean {
  return SELLER_TITLE.test(title.replace(/[\u2018\u2019]/g, "'"));
}

/** A reply draft is only useful on a post that has real text to answer. */
export function hasUsableText(title: string, snippet: string): boolean {
  return cleanPostTitle(title).length >= 12 || snippet.trim().length >= 40;
}
