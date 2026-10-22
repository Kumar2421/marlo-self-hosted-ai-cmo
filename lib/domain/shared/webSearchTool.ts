import type { ToolDef } from "@/lib/llm";

export type TavilyResult = { title: string; url: string; content: string };

/** Real Tavily search call — https://docs.tavily.com/documentation/api-reference/endpoint/search.
 * Bearer-auth, not an api_key body field. Returns the parsed results array —
 * used directly by deterministic callers (GEO citation check) and wrapped
 * into a string by the LLM tool below. */
export async function tavilySearchRaw(apiKey: string, query: string, maxResults = 5): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic" }),
    // A hung search must cost one call, not the whole function budget.
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Tavily search failed: HTTP ${res.status}`);

  const data = await res.json();
  return (data.results ?? []).map((r: { title: string; url: string; content: string }) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}

async function tavilySearch(apiKey: string, query: string): Promise<string> {
  let results: TavilyResult[];
  try {
    results = await tavilySearchRaw(apiKey, query);
  } catch {
    return "Search failed. Answer from what you already know instead.";
  }
  if (results.length === 0) return "No results found for this query.";
  return JSON.stringify(results);
}

/** Gives a generator's LLM call real, current web access via Tavily — used
 * only where the doc genuinely needs live research (Competitor Analysis,
 * Content Strategy), not wired into every generator. */
export function buildWebSearchTool(tavilyApiKey: string): ToolDef {
  return {
    name: "web_search",
    description:
      "Search the live web for current information — competitor pricing/positioning, recent news, " +
      "trending topics or discussions in a niche. Use it to verify or fill in specifics you don't " +
      "already have from the crawled page data. Don't call it more than a couple of times per document.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A concise, specific search query." },
      },
      required: ["query"],
    },
    execute: async (input) => {
      const query = typeof input.query === "string" ? input.query : "";
      if (!query.trim()) return "No query provided.";
      return tavilySearch(tavilyApiKey, query);
    },
  };
}
