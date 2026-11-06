import { tavilySearchRaw } from "../shared/webSearchTool.ts";

/** One web result. Providers differ in extras; these three are all the lead engine needs. */
export type SearchHit = { title: string; url: string; content: string };

/**
 * A web search engine behind one small interface, so lead discovery does not care which one answers.
 * Tavily is the engine today; a self-hosted SearXNG can be added as another provider without touching
 * anything that searches.
 */
export type SearchProvider = {
  id: string;
  search(query: string, limit: number): Promise<SearchHit[]>;
};

export function tavilyProvider(apiKey: string): SearchProvider {
  return {
    id: "tavily",
    async search(query, limit) {
      const results = await tavilySearchRaw(apiKey, query, limit);
      return results.map((r) => ({ title: r.title ?? "", url: r.url ?? "", content: r.content ?? "" }));
    },
  };
}
