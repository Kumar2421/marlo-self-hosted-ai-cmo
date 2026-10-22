import { deriveOpportunityRecommendations } from "../search/opportunityRecommendations.ts";
import { catalogEntry, genericEntry } from "./issueRecommendations.ts";
import type { Recommendation, RecommendationPriority, RecommendationType } from "./recommendationTypes.ts";

type FindingLike = {
  id: string;
  entityType: string;
  entityId: string;
  url: string | null;
  evidence: Record<string, unknown>;
  source?: string;
  category?: string;
};

type FindingPageEvidence = {
  meta?: { canonical?: string; indexable?: boolean };
  contentRelevance?: { keywordRelevance?: number };
  serverTiming?: { ttfbMs?: number };
};

function pageEvidence(finding: FindingLike): FindingPageEvidence {
  const page = finding.evidence.page;
  return page && typeof page === "object" ? (page as FindingPageEvidence) : {};
}

function recommendation(
  finding: FindingLike,
  type: RecommendationType,
  title: string,
  summary: string,
  priority: RecommendationPriority,
  kind: Recommendation["implementation"]["kind"],
  description: string,
  evidence: Record<string, unknown>,
): Recommendation {
  return {
    id: `${finding.id}:${type}`,
    findingId: finding.id,
    type,
    title,
    summary,
    priority,
    target: {
      url: finding.url ?? undefined,
      query: finding.entityType === "query" ? finding.entityId : undefined,
    },
    evidence,
    implementation: { kind, description },
  };
}

export function deriveRecommendations(finding: FindingLike): Recommendation[] {
  // Findings created from a search opportunity carry their own evidence and steps, not page-audit conditions.
  const fromOpportunity = deriveOpportunityRecommendations(finding);
  if (fromOpportunity) return fromOpportunity;

  // Findings Marlo created itself (SEO audit, GEO readiness, Lighthouse) are recognised by what they are, not by page evidence they do not carry.
  const entry = catalogEntry(finding);
  if (entry) {
    return [recommendation(finding, entry.type, entry.title, entry.summary, entry.priority, entry.kind, entry.action, entry.evidence)];
  }

  const page = pageEvidence(finding);
  const recommendations: Recommendation[] = [];

  if (page.meta?.indexable === false) {
    recommendations.push(
      recommendation(
        finding,
        "noindex",
        "Remove the noindex directive",
        "Allow the ranking page to be indexed if it is intended to receive organic search traffic.",
        "high",
        "code",
        "Remove the noindex directive from the page or its robots configuration, then re-crawl and verify indexability.",
        { indexable: false },
      ),
    );
  }

  // Only judge the canonical when page metadata was actually collected; an absent `meta` means "unknown", not "missing".
  if (page.meta && !page.meta.canonical) {
    recommendations.push(
      recommendation(
        finding,
        "missing_canonical",
        "Add a canonical URL",
        "Declare the preferred URL for this ranking page to consolidate search signals.",
        "high",
        "code",
        "Add a self-referencing canonical URL using the page's final public URL, then re-check the page.",
        { canonical: null },
      ),
    );
  }

  const keywordRelevance = page.contentRelevance?.keywordRelevance;
  if (typeof keywordRelevance === "number" && keywordRelevance < 50) {
    recommendations.push(
      recommendation(
        finding,
        "low_keyword_relevance",
        "Improve keyword relevance",
        "Align the page's visible content, headings, and topic coverage more closely with the ranking query.",
        keywordRelevance < 30 ? "high" : "medium",
        "content",
        "Review the query intent and strengthen relevant headings, copy, entities, and supporting content without keyword stuffing.",
        { keywordRelevance },
      ),
    );
  }

  const ttfbMs = page.serverTiming?.ttfbMs;
  if (typeof ttfbMs === "number" && ttfbMs > 1500) {
    recommendations.push(
      recommendation(
        finding,
        "slow_ttfb",
        "Investigate server response time",
        "Reduce time to first byte so the page begins responding faster.",
        ttfbMs > 2500 ? "high" : "medium",
        "manual",
        "Profile the request path, backend queries, caching, and upstream calls before making a performance change.",
        { ttfbMs },
      ),
    );
  }

  // Search-console findings with healthy page data legitimately have nothing to add. Anything else we cannot
  // recognise gets a generic review step rather than a specific recommendation that might be wrong.
  if (recommendations.length === 0 && (finding.source ?? "").toLowerCase() !== "search-console") {
    const generic = genericEntry(finding);
    return [recommendation(finding, generic.type, generic.title, generic.summary, generic.priority, generic.kind, generic.action, generic.evidence)];
  }


  return recommendations;
}
