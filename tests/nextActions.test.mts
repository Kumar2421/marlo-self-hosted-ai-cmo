import { test } from "node:test";
import * as assert from "node:assert";
import { rankNextActions } from "../lib/domain/search/nextActions.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";

test("rankNextActions - returns plain-language action cards", () => {
  const findings: Finding[] = [
    {
      id: "f1",
      projectId: "p1",
      source: "search-console",
      category: "search-visibility",
      entityType: "query",
      entityId: "ranking:test search",
      url: "https://example.com",
      severity: "info",
      evidence: {},
      recommendation: "",
      status: "new",
      firstSeen: "2024-01-01T00:00:00Z",
      lastSeen: "2024-01-01T00:00:00Z",
      resolvedAt: null,
    },
  ];

  const opportunities = {
    ranking: [{ query: "test search", metrics: { impressions: 1000, position: 3.5, clicks: 50, ctr: 0.05 } }],
    ctr: [{ query: "other search", metrics: { impressions: 500, position: 1.5, clicks: 75, ctr: 0.15 } }],
    declining: [{ query: "declining search", metrics: { impressions: 200, clicks: 10, ctr: 0.05, position: 3 } }],
    newQueries: [],
    lostQueries: [],
  };

  const actions = rankNextActions(findings, opportunities, 3);

  assert.strictEqual(actions.length, 3);
  assert.strictEqual(actions[0].findingId, "f1", "should link to matching finding");
  assert.ok(actions[0].title.includes("test search"), "should include search query in title");
  assert.ok(actions[0].why.includes("1,000"), "should include impression count in plain language");
  assert.ok(!/~|could add|could lift/.test(actions[0].expectedImpact), "no invented forecast");
  assert.ok(actions[0].expectedImpact.includes("1,000 views"), "states measured numbers only");
});

test("rankNextActions - skips fixed findings", () => {
  const findings: Finding[] = [
    {
      id: "f1",
      projectId: "p1",
      source: "search-console",
      category: "search-visibility",
      entityType: "query",
      entityId: "ranking:test search",
      url: "https://example.com",
      severity: "info",
      evidence: {},
      recommendation: "",
      status: "fixed",
      firstSeen: "2024-01-01T00:00:00Z",
      lastSeen: "2024-01-01T00:00:00Z",
      resolvedAt: "2024-01-02T00:00:00Z",
    },
  ];

  const opportunities = {
    ranking: [{ query: "test search", metrics: { impressions: 1000, position: 3.5, clicks: 50, ctr: 0.05 } }],
    ctr: [],
    declining: [],
    newQueries: [],
    lostQueries: [],
  };

  const actions = rankNextActions(findings, opportunities, 3);

  assert.strictEqual(actions.length, 0, "a fixed finding produces no card");
});

test("rankNextActions - respects limit", () => {
  const opportunities = {
    ranking: [
      { query: "search 1", metrics: { impressions: 1000, position: 3.5, clicks: 50, ctr: 0.05 } },
      { query: "search 2", metrics: { impressions: 900, position: 3.5, clicks: 45, ctr: 0.05 } },
    ],
    ctr: [
      { query: "search 3", metrics: { impressions: 500, position: 1.5, clicks: 75, ctr: 0.15 } },
    ],
    declining: [],
    newQueries: [],
    lostQueries: [],
  };

  const actions = rankNextActions([], opportunities, 2);
  assert.strictEqual(actions.length, 2, "should respect limit");
});
