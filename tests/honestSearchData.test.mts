import test from "node:test";
import assert from "node:assert/strict";
import { computeDelta, overviewDataFlags } from "../lib/domain/search/deltaView.ts";
import { nextActionsEmptyState, rankNextActions } from "../lib/domain/search/nextActions.ts";
import { assessSnapshotRows, captureSearchSnapshot, PartialSnapshotError } from "../lib/domain/search/searchConsoleClient.ts";
import { buildOpportunities } from "../lib/domain/search/searchOpportunities.ts";
import { buildSnapshotPayload, snapshotRanges } from "../lib/domain/search/searchSnapshot.ts";
import { evaluateOutcome } from "../lib/domain/search/actionOutcome.ts";
import { recheckOpportunityFinding, TOO_EARLY_REASON } from "../lib/domain/search/opportunityFinding.ts";
import { buildTrafficView } from "../lib/domain/analytics/trafficView.ts";
import { classifyGoogleError, ga4FromReport, searchTraffic, totalsFromDays, trafficWindow } from "../lib/domain/analytics/trafficResult.ts";
import { parseLighthouse } from "../lib/domain/seo/pageSpeedInsights.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";

const row = (q: string, impressions = 200, position = 6) => ({ keys: [q], clicks: 5, impressions, ctr: 0.025, position });

// ---- computeDelta ----
test("computeDelta: empty baseline gives no delta (audit D3)", () => {
  assert.equal(computeDelta(500, 0), null);
  assert.equal(computeDelta(12, 0, "position"), null);
  assert.equal(computeDelta(10, undefined), null);
  assert.equal(computeDelta(Number.NaN, 5), null);
  assert.equal(computeDelta(0, 12, "position"), null, "position 0 is no data, not first place");
});

test("computeDelta: counts rise and fall", () => {
  assert.deepEqual(computeDelta(150, 100), { change: 50, magnitude: 50, direction: "up", tone: "good" });
  assert.equal(computeDelta(80, 100)?.tone, "bad");
  assert.equal(computeDelta(100, 100)?.direction, "flat");
});

test("computeDelta: positions are lower-is-better and rounded", () => {
  const better = computeDelta(8.123, 20.4567, "position");
  assert.equal(better?.direction, "up");
  assert.equal(better?.tone, "good");
  assert.equal(better?.magnitude, 12.3);
  const worse = computeDelta(12.346, 3, "position");
  assert.equal(worse?.tone, "bad");
  assert.equal(worse?.magnitude, 9.3);
});

test("overviewDataFlags: collecting vs no comparison", () => {
  const w = (n: number) => ({ queries: Array.from({ length: n }, () => ({})) });
  assert.deepEqual(overviewDataFlags({ d28: w(0), prev28: w(0) }), { collectingData: true, noComparison: false });
  assert.deepEqual(overviewDataFlags({ d28: w(3), prev28: w(0) }), { collectingData: false, noComparison: true });
  assert.deepEqual(overviewDataFlags({ d28: w(3), prev28: w(2) }), { collectingData: false, noComparison: false });
});

// ---- next actions ----
test("nextActionsEmptyState: green state only with enough data (audit D3)", () => {
  const snap = (impressions: number[]) => ({ windows: { d28: { queries: impressions.map((i) => ({ impressions: i })) } } });
  assert.equal(nextActionsEmptyState(snap([])).kind, "not_enough_data");
  assert.equal(nextActionsEmptyState(snap([40, 99])).kind, "not_enough_data");
  assert.equal(nextActionsEmptyState(snap([40, 100])).kind, "nothing_to_fix");
  assert.equal(nextActionsEmptyState(null).kind, "not_enough_data");
});

const finding = (entityId: string, status: Finding["status"]): Finding => ({
  id: "f1", projectId: "p", source: "search-console", category: "search-visibility", entityType: "query", entityId,
  url: null, severity: "info", evidence: {}, recommendation: "", status, firstSeen: "", lastSeen: "", resolvedAt: null,
});

test("rankNextActions: no invented forecast, no card for a verified finding (audit D8, probe 1)", () => {
  const opp = { ranking: [{ query: "seo tool", metrics: { impressions: 1000, position: 7 } }], ctr: [], declining: [], newQueries: [], lostQueries: [] };
  const cards = rankNextActions([], opp, 3);
  assert.equal(cards.length, 1);
  assert.doesNotMatch(cards[0].expectedImpact + cards[0].why, /~|could add|could lift|monthly clicks/);
  assert.equal(rankNextActions([finding("ranking:seo tool", "verified")], opp, 3).length, 0);
  assert.equal(rankNextActions([finding("ranking:seo tool", "fixed")], opp, 3).length, 0);
  assert.equal(rankNextActions([finding("ranking:seo tool", "failed")], opp, 3).length, 1, "a failed fix is still open work");
});

test("rankNextActions: a finished card makes room for the next opportunity", () => {
  const opp = {
    ranking: [1, 2, 3].map((i) => ({ query: `q${i}`, metrics: { impressions: 1000 - i, position: 7 } })),
    ctr: [], declining: [], newQueries: [], lostQueries: [],
  };
  const cards = rankNextActions([finding("ranking:q1", "verified")], opp, 3);
  assert.deepEqual(cards.map((c) => c.title), ['Improve page for "q2"', 'Improve page for "q3"']);
});

// ---- snapshot capture (audit D12, probe 3) ----
test("assessSnapshotRows: empty d28 with a populated prev28 is rejected", () => {
  const prev = Array.from({ length: 8 }, (_, i) => row(`q${i}`));
  const verdict = assessSnapshotRows({ d7: [], d28: [], d90: [], prev28: prev, d28Pages: [] });
  assert.equal(verdict.ok, false);
});

test("assessSnapshotRows: a fully empty site is valid; complete data is valid", () => {
  assert.deepEqual(assessSnapshotRows({ d7: [], d28: [], d90: [], prev28: [], d28Pages: [] }), { ok: true });
  const r = [row("a")];
  assert.deepEqual(assessSnapshotRows({ d7: r, d28: r, d90: r, prev28: r, d28Pages: [{ ...row("a"), keys: ["a", "https://x.com/"] }] }), { ok: true });
});

test("assessSnapshotRows: main window without 90-day or page rows is partial", () => {
  const r = [row("a")];
  assert.equal(assessSnapshotRows({ d7: r, d28: r, d90: [], prev28: r, d28Pages: r }).ok, false);
  assert.equal(assessSnapshotRows({ d7: r, d28: r, d90: r, prev28: r, d28Pages: [] }).ok, false);
});

test("captureSearchSnapshot throws PartialSnapshotError instead of producing 'lost' queries", async () => {
  const now = new Date("2026-10-21T00:00:00Z");
  const ranges = snapshotRanges(now);
  const prev = Array.from({ length: 8 }, (_, i) => row(`q${i}`));
  const fetchRows = async (_s: string, start: string, _e: string, dims: string[]) =>
    start === ranges.prev28.startDate && dims.length === 1 ? prev : [];
  await assert.rejects(() => captureSearchSnapshot(fetchRows, "sc-domain:x.com", now), PartialSnapshotError);
  // For contrast: what the old behaviour stored.
  const stored = buildSnapshotPayload({ now, siteUrl: "x", ranges, rows: { d7: [], d28: [], d90: [], prev28: prev, d28Pages: [] } });
  assert.ok(buildOpportunities(stored).lostQueries.length > 0);
});

// ---- outcome / recheck freshness (audit D6, probe 4) ----
const impl = {
  via: "manual" as const,
  implementedAt: "2026-10-01T00:00:00Z",
  baseline: { capturedAt: "2026-10-01", snapshotDate: "2026-10-01", query: "q", impressions: 500, clicks: 10, ctr: 0.02, position: 8, source: "snapshot" as const },
};
const cur = { query: "q", impressions: 500, clicks: 10, ctr: 0.02, position: 8.1 };

test("evaluateOutcome: a snapshot older than implementedAt + 7 days is 'waiting'", () => {
  const now = new Date("2026-10-21T00:00:00Z");
  const stale = evaluateOutcome({ implementation: impl, actionType: "improve_page" as never, current: cur, now, snapshotDate: "2026-10-05" });
  assert.equal(stale.status, "waiting");
  assert.equal(stale.confidence, null);
  assert.ok(stale.daysUntilReady >= 1);
  const edge = evaluateOutcome({ implementation: impl, actionType: "improve_page" as never, current: cur, now, snapshotDate: "2026-10-07" });
  assert.equal(edge.status, "waiting", "day 6 is still before day 7");
  const fresh = evaluateOutcome({ implementation: impl, actionType: "improve_page" as never, current: cur, now, snapshotDate: "2026-10-08" });
  assert.equal(fresh.status, "unchanged");
  assert.equal(fresh.confidence, "solid");
});

test("evaluateOutcome: without a snapshot date the behaviour is unchanged", () => {
  const out = evaluateOutcome({ implementation: impl, actionType: "improve_page" as never, current: cur, now: new Date("2026-10-21T00:00:00Z") });
  assert.equal(out.status, "unchanged");
});

const payloadAt = (capturedAt: string) => {
  const ranges = snapshotRanges(new Date(capturedAt));
  const r = [row("seo tool", 300, 7.5)];
  return buildSnapshotPayload({ now: new Date(capturedAt), siteUrl: "x", ranges, rows: { d7: r, d28: r, d90: r, prev28: r, d28Pages: [{ ...row("seo tool"), keys: ["seo tool", "https://x.com/a"] }] } });
};
const oppFinding = {
  severity: "info" as const,
  recommendation: "Do it",
  evidence: { query: "seo tool", opportunity: { type: "ranking" }, impressions: 300, clicks: 5, ctr: 0.02, position: 7.5 },
};

test("recheckOpportunityFinding: snapshot older than fix + 3 days is 'too early' and not a failure", () => {
  const snapshot = { snapshotDate: "2026-10-10", payload: payloadAt("2026-10-10T06:00:00Z") };
  const result = recheckOpportunityFinding(oppFinding, snapshot, new Date("2026-10-11T00:00:00Z"), "2026-10-09T12:00:00Z");
  assert.equal(result.tooEarly, true);
  assert.equal(result.evidence.lastCheck.reason, TOO_EARLY_REASON);
  assert.equal(result.evidence.lastCheck.resolved, false);
});

test("recheckOpportunityFinding: a snapshot captured 3+ days after the fix is judged normally", () => {
  const snapshot = { snapshotDate: "2026-10-13", payload: payloadAt("2026-10-13T00:00:00Z") };
  const result = recheckOpportunityFinding(oppFinding, snapshot, new Date("2026-10-14T00:00:00Z"), "2026-10-10T00:00:00Z");
  assert.equal(result.tooEarly, false);
  assert.match(result.evidence.lastCheck.reason, /Still at position/);
});

test("recheckOpportunityFinding: no changedAt keeps the old behaviour", () => {
  const snapshot = { snapshotDate: "2026-10-13", payload: payloadAt("2026-10-13T00:00:00Z") };
  assert.equal(recheckOpportunityFinding(oppFinding, snapshot).tooEarly, false);
});

// ---- traffic (audit D2) ----
test("searchTraffic: an error is not zeros", () => {
  const r = searchTraffic({ connected: true, error: "Google token request failed: HTTP 401", byDate: [] });
  assert.equal(r.status, "error");
  assert.equal(r.totals, null);
  assert.deepEqual(r.byDate, []);
  assert.equal(r.needsReconnect, true);
  assert.doesNotMatch(r.reason ?? "", /HTTP 401/, "no raw Google text");
});

test("searchTraffic: empty rows is no_data, not connected is not_connected, real rows are ok", () => {
  const none = searchTraffic({ connected: true, error: null, byDate: [] });
  assert.equal(none.status, "no_data");
  assert.equal(none.totals, null);
  const zeros = searchTraffic({ connected: true, error: null, byDate: [{ date: "2026-10-01", clicks: 0, impressions: 0, ctr: 0, position: 0 }] });
  assert.equal(zeros.status, "no_data");
  assert.equal(searchTraffic({ connected: false, error: null, byDate: [] }).status, "not_connected");
  const days = [
    { date: "a", clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
    { date: "b", clicks: 0, impressions: 300, ctr: 0, position: 8 },
  ];
  const ok = searchTraffic({ connected: true, error: null, byDate: days });
  assert.equal(ok.status, "ok");
  assert.deepEqual(ok.totals, { clicks: 10, impressions: 400, ctr: 10 / 400, position: (4 * 100 + 8 * 300) / 400 });
  assert.equal(totalsFromDays([]), null);
});

test("classifyGoogleError: only auth failures ask for reconnect", () => {
  assert.equal(classifyGoogleError("Google token request failed: HTTP 401").needsReconnect, true);
  assert.equal(classifyGoogleError("invalid_grant").needsReconnect, true);
  assert.equal(classifyGoogleError("Search Console query failed: HTTP 503").needsReconnect, false);
  assert.equal(classifyGoogleError("Search Console query failed: HTTP 429").needsReconnect, false);
});

test("trafficWindow is UTC: 28 days ending 3 days ago, whatever the host zone", () => {
  assert.deepEqual(trafficWindow(new Date("2026-10-21T23:30:00Z")), { startDate: "2026-09-21", endDate: "2026-10-18" });
  assert.deepEqual(trafficWindow(new Date("2026-03-02T00:10:00Z")), { startDate: "2026-01-31", endDate: "2026-02-27" });
});

test("ga4FromReport: no rows is null, not 0/0/0", () => {
  assert.equal(ga4FromReport({}), null);
  assert.equal(ga4FromReport({ rows: [] }), null);
  assert.deepEqual(ga4FromReport({ rows: [{ metricValues: [{ value: "5" }, { value: "3" }, { value: "9" }] }] }), { sessions: 5, activeUsers: 3, screenPageViews: 9 });
});

// ---- buildTrafficView ----
test("buildTrafficView: cards only when totals exist", () => {
  const ok = buildTrafficView({ status: "ok", totals: { clicks: 1234, impressions: 56789, ctr: 0.0217, position: 8.44 } });
  assert.equal(ok.kind, "cards");
  assert.deepEqual(ok.cards.map((c) => c.value), ["1,234", "56,789", "2.2%", "8.4"]);
  assert.equal(ok.message, null);
});

test("buildTrafficView: error shows text and reconnect, never cards", () => {
  const view = buildTrafficView({ status: "error", reason: "Google didn't accept the saved connection.", needs_reconnect: true, totals: null });
  assert.equal(view.kind, "error");
  assert.deepEqual(view.cards, []);
  assert.equal(view.showReconnect, true);
  assert.match(view.message ?? "", /Google didn't accept/);
  assert.equal(buildTrafficView({ status: "error", totals: null }).showReconnect, false);
});

test("buildTrafficView: no data and not connected", () => {
  const nodata = buildTrafficView({ status: "no_data", totals: null });
  assert.equal(nodata.kind, "no_data");
  assert.match(nodata.message ?? "", /No data yet/);
  assert.equal(buildTrafficView({ status: "not_connected", totals: null }).kind, "not_connected");
});

test("buildTrafficView: legacy responses without status are never read as zero data", () => {
  assert.equal(buildTrafficView({ site: "sc-domain:x.com", gscError: "boom", totals: null }).kind, "error");
  assert.equal(buildTrafficView({ site: "sc-domain:x.com", totals: null }).kind, "no_data");
  assert.equal(buildTrafficView({ site: null, totals: null }).kind, "not_connected");
  assert.equal(buildTrafficView(null).cards.length, 0);
});

test("buildTrafficView: position is a dash without impressions, never 0.0", () => {
  const view = buildTrafficView({ status: "ok", totals: { clicks: 1, impressions: 0, ctr: 0, position: 0 } });
  assert.equal(view.cards.find((c) => c.key === "position")?.value, "—");
});

// ---- PageSpeed (audit D14 / probe) ----
test("parseLighthouse: missing categories are undefined, not 0", () => {
  const out = parseLighthouse({ lighthouseResult: { categories: { performance: { score: 0.91 } }, audits: {} } });
  assert.equal(out.scores.performance, 91);
  assert.equal(out.scores.accessibility, undefined);
  assert.equal(out.scores.bestPractices, undefined);
  assert.equal(out.scores.seo, undefined);
});

test("parseLighthouse: missing audits are 'Not measured' / Unknown, not 'N/A' + Fail", () => {
  const out = parseLighthouse({ lighthouseResult: { categories: {}, audits: { "largest-contentful-paint": { score: 0.4, displayValue: "4.1 s" } } } });
  assert.deepEqual(out.cwv.lcp, { value: "4.1 s", status: "Fail" });
  assert.deepEqual(out.cwv.fcp, { value: "Not measured", status: "Unknown" });
  assert.deepEqual(out.cwv.cls, { value: "Not measured", status: "Unknown" });
  const empty = parseLighthouse({});
  assert.equal(empty.scores.performance, undefined);
  assert.equal(empty.cwv.lcp.status, "Unknown");
});

test("parseLighthouse: a real 0 score stays 0 and scores round", () => {
  const out = parseLighthouse({ lighthouseResult: { categories: { seo: { score: 0 }, performance: { score: 0.876 } }, audits: {} } });
  assert.equal(out.scores.seo, 0);
  assert.equal(out.scores.performance, 88);
});
