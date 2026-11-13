import { tavilySearchRaw } from "../shared/webSearchTool.ts";

/** One web result. Providers differ in extras; these three are all the lead engine needs. */
export type SearchHit = { title: string; url: string; content: string };

/** Optional narrowing. A provider that cannot honour an option ignores it, so callers still re-check what they get. */
export type SearchOptions = {
  /** Only results from these domains, e.g. ["reddit.com"]. */
  includeDomains?: readonly string[];
  /** Only results from this recent window. */
  timeRange?: "day" | "week" | "month" | "year";
};

/**
 * A web search engine behind one small interface, so lead discovery does not care which one answers.
 * Tavily is the engine today; a self-hosted SearXNG can be added as another provider without touching
 * anything that searches.
 */
export type SearchProvider = {
  id: string;
  search(query: string, limit: number, options?: SearchOptions): Promise<SearchHit[]>;
};

export function tavilyProvider(apiKey: string): SearchProvider {
  return {
    id: "tavily",
    async search(query, limit, options) {
      // Plain searches keep the shared helper; narrowed ones need the extra request fields.
      if (!options?.includeDomains?.length && !options?.timeRange) {
        const results = await tavilySearchRaw(apiKey, query, limit);
        return results.map((r) => ({ title: r.title ?? "", url: r.url ?? "", content: r.content ?? "" }));
      }
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          query,
          max_results: limit,
          search_depth: "basic",
          ...(options.includeDomains?.length ? { include_domains: options.includeDomains } : {}),
          ...(options.timeRange ? { time_range: options.timeRange } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Tavily search failed: HTTP ${res.status}`);
      const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
      return (data.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", content: r.content ?? "" }));
    },
  };
}
