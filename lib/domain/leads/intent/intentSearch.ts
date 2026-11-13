import type { SearchProvider } from "../../websearch/searchProvider.ts";
import { canonicalPostUrl, cleanPostTitle, hasUsableText, looksLikeSeller, subredditOf } from "./redditPosts.ts";
import type { PostCandidate, RequestFound } from "./IntentClassifier.ts";
import type { ReplyRequest } from "./replyDrafter.ts";

/**
 * Requests from the open web: public Reddit posts where someone asks for what the user sells. Search for posts phrased
 * like a buyer's ask, drop obvious sellers, let a model pick the real requests (each with an exact quote), and save
 * them as leads the user can answer from their own account. All I/O comes in through ports, so it is tested with fakes.
 */

export const MAX_CANDIDATES = 20;
const RESULTS_PER_QUERY = 10;
const QUERY_SELLS_CHARS = 60;

export type IntentOffer = { sells: string; whoPays?: string };

export type IntentLeadDraft = {
  /** The post title, as written. */
  name: string;
  subreddit: string;
  /** Canonical post address. */
  url: string;
  quote: string;
  /** "Asked on r/sub: \"quote\"." */
  reason: string;
  /** A model-written reply the user can edit and post by hand; null when none could be drafted (a template is used instead). */
  reply: string | null;
};

export type IntentPorts = {
  provider: SearchProvider;
  /** Post addresses already saved as leads for this project (canonical form). */
  knownUrls: () => Promise<Set<string>>;
  classify: (posts: PostCandidate[]) => Promise<{ ok: true; requests: RequestFound[] } | { ok: false; reason: string }>;
  /** Optional: drafts a reply per kept request (id to reply). A failure here never fails the search. */
  draft?: (requests: ReplyRequest[]) => Promise<Map<string, string>>;
};

export type IntentResult = {
  leads: IntentLeadDraft[];
  /** Posts a model looked at. */
  considered: number;
  droppedSellers: number;
  duplicates: number;
  /** The model could not be used, so nothing was judged. Distinct from "no requests found". */
  classifierFailed: boolean;
};

/** Up to three web queries phrased like a buyer's ask for what the business sells, e.g. "looking for custom software". */
export type IntentFocus = {
  /** Saved keywords the user wants watched, e.g. "crm for clinics". */
  keywords?: readonly string[];
  /** Saved subreddits ("r/name" or "name") to look in first. */
  subreddits?: readonly string[];
};

const MAX_QUERIES = 5;

export function buildIntentQueries(offer: IntentOffer, locations: readonly string[] = [], focus: IntentFocus = {}): string[] {
  const sells = offer.sells.trim().slice(0, QUERY_SELLS_CHARS).trim();
  if (!sells) return [];
  const place = locations.map((l) => l.trim()).find(Boolean);
  const queries = [`looking for ${sells}${place ? ` ${place}` : ""}`, `can anyone recommend ${sells} for my business`, `need help with ${sells}`];
  // The user's own saved focus adds to, and never replaces, what the website says.
  const keyword = (focus.keywords ?? []).map((k) => k.trim()).find(Boolean);
  if (keyword) queries.push(`looking for ${keyword.slice(0, QUERY_SELLS_CHARS)}`);
  const sub = (focus.subreddits ?? []).map((s) => s.trim().replace(/^\/?r\//i, "")).find((s) => /^[A-Za-z0-9_]{2,21}$/.test(s));
  if (sub) queries.push(`r/${sub} looking for ${keyword ?? sells}`.slice(0, 120));
  return queries.slice(0, MAX_QUERIES);
}

export async function searchIntentLeads(
  ports: IntentPorts,
  input: { offer: IntentOffer; locations?: readonly string[]; focus?: IntentFocus; maxLeads?: number },
): Promise<IntentResult> {
  const empty: IntentResult = { leads: [], considered: 0, droppedSellers: 0, duplicates: 0, classifierFailed: false };
  const queries = buildIntentQueries(input.offer, input.locations, input.focus);
  if (queries.length === 0) return empty;

  const hitSets = await Promise.all(
    queries.map((q) => ports.provider.search(q, RESULTS_PER_QUERY, { includeDomains: ["reddit.com"], timeRange: "month" }).catch(() => [])),
  );
  const known = await ports.knownUrls();

  const seen = new Set<string>();
  let droppedSellers = 0;
  let duplicates = 0;
  const candidates: (PostCandidate & { url: string; subreddit: string; rawTitle: string })[] = [];
  for (const hit of hitSets.flat()) {
    const url = canonicalPostUrl(hit.url);
    const subreddit = subredditOf(hit.url);
    if (!url || !subreddit || seen.has(url)) continue;
    seen.add(url);
    const title = cleanPostTitle(hit.title);
    if (known.has(url)) {
      duplicates += 1;
      continue;
    }
    if (looksLikeSeller(title) || !hasUsableText(title, hit.content)) {
      droppedSellers += 1;
      continue;
    }
    candidates.push({ id: `p${candidates.length + 1}`, title, snippet: hit.content.replace(/\s+/g, " ").trim(), url, subreddit, rawTitle: title });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  if (candidates.length === 0) return { ...empty, droppedSellers, duplicates };

  const verdict = await ports.classify(candidates.map(({ id, title, snippet }) => ({ id, title, snippet }))).catch(() => ({ ok: false as const, reason: "failed" }));
  if (!verdict.ok) return { ...empty, considered: candidates.length, droppedSellers, duplicates, classifierFailed: true };

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const kept = verdict.requests.filter((r) => byId.has(r.id)).slice(0, input.maxLeads ?? 10);
  let replies = new Map<string, string>();
  if (ports.draft && kept.length > 0) {
    replies = await ports
      .draft(kept.map((r) => { const c = byId.get(r.id)!; return { id: r.id, title: c.title, snippet: c.snippet, subreddit: c.subreddit, quote: r.quote }; }))
      .catch(() => new Map<string, string>());
  }
  const leads: IntentLeadDraft[] = kept.map((r) => {
    const c = byId.get(r.id)!;
    return { name: c.title.slice(0, 120), subreddit: c.subreddit, url: c.url, quote: r.quote, reason: `Asked on r/${c.subreddit}: "${r.quote}".`, reply: replies.get(r.id) ?? null };
  });
  return { leads, considered: candidates.length, droppedSellers, duplicates, classifierFailed: false };
}
