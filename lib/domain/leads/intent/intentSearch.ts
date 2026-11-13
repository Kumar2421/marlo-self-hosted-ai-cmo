import type { SearchProvider } from "../../websearch/searchProvider.ts";
import { canonicalPostUrl, cleanPostTitle, hasUsableText, looksLikeSeller, subredditOf } from "./redditPosts.ts";
import type { PostCandidate, RequestFound } from "./IntentClassifier.ts";

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
  /** "Asked on r/sub: "quote"." */
  reason: string;
};

export type IntentPorts = {
  provider: SearchProvider;
  /** Post addresses already saved as leads for this project (canonical form). */
  knownUrls: () => Promise<Set<string>>;
  classify: (posts: PostCandidate[]) => Promise<{ ok: true; requests: RequestFound[] } | { ok: false; reason: string }>;
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
export function buildIntentQueries(offer: IntentOffer, locations: readonly string[] = []): string[] {
  const sells = offer.sells.trim().slice(0, QUERY_SELLS_CHARS).trim();
  if (!sells) return [];
  const place = locations.map((l) => l.trim()).find(Boolean);
  const queries = [`looking for ${sells}${place ? ` ${place}` : ""}`, `can anyone recommend ${sells} for my business`, `need help with ${sells}`];
  return queries;
}

export async function searchIntentLeads(
  ports: IntentPorts,
  input: { offer: IntentOffer; locations?: readonly string[]; maxLeads?: number },
): Promise<IntentResult> {
  const empty: IntentResult = { leads: [], considered: 0, droppedSellers: 0, duplicates: 0, classifierFailed: false };
  const queries = buildIntentQueries(input.offer, input.locations);
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
  const leads: IntentLeadDraft[] = [];
  for (const r of verdict.requests) {
    const c = byId.get(r.id);
    if (!c) continue;
    leads.push({ name: c.title.slice(0, 120), subreddit: c.subreddit, url: c.url, quote: r.quote, reason: `Asked on r/${c.subreddit}: "${r.quote}".` });
  }
  return { leads: leads.slice(0, input.maxLeads ?? 10), considered: candidates.length, droppedSellers, duplicates, classifierFailed: false };
}
