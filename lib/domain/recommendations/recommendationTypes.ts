export const RECOMMENDATION_TYPES = [
  "missing_canonical",
  "noindex",
  "low_keyword_relevance",
  "slow_ttfb",
  "lighthouse_issue",
  // Findings Marlo creates itself (see lib/domain/recommendations/issueRecommendations.ts)
  "seo_issue",
  "geo_readiness",
  "geo_mention_gap",
  "review_finding",
  // Search-opportunity findings (see lib/domain/search/opportunityRecommendations.ts)
  "improve_search_intent_alignment",
  "rewrite_snippet",
  "investigate_decline",
  "build_on_new_query",
  "investigate_lost_query",
] as const;

export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];
export type RecommendationPriority = "low" | "medium" | "high";

export type Recommendation = {
  id: string;
  findingId: string;
  type: RecommendationType;
  title: string;
  summary: string;
  priority: RecommendationPriority;
  target: { url?: string; query?: string };
  evidence: Record<string, unknown>;
  implementation: {
    kind: "manual" | "content" | "code";
    description: string;
  };
};
