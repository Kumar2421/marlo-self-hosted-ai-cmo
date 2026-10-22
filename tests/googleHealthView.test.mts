import test from "node:test";
import assert from "node:assert/strict";
import { RECONNECT_TEXT, googleHealthView, googleReconnectHref, referralNotice } from "../lib/domain/integrations/googleHealthView.ts";
import { doneLineType } from "../lib/domain/integrations/logLine.ts";
import { buildTrafficView } from "../lib/domain/analytics/trafficView.ts";
import { buildGoogleConnectionStatus } from "../lib/domain/integrations/connectionStatus.ts";

test("googleHealthView: no status read yet is unknown, never healthy", () => {
  for (const input of [null, undefined]) {
    const view = googleHealthView(input);
    assert.equal(view.state, "unknown");
    assert.equal(view.badge, null);
    assert.equal(view.showReconnect, false);
  }
});

test("googleHealthView: not connected has no badge and no reconnect", () => {
  const view = googleHealthView({ connected: false, needsReconnect: false, reason: null });
  assert.equal(view.state, "not_connected");
  assert.equal(view.badge, null);
  assert.equal(view.showReconnect, false);
});

test("googleHealthView: connected and healthy is the green Connected badge", () => {
  const view = googleHealthView({ connected: true, needsReconnect: false, reason: null });
  assert.equal(view.state, "connected");
  assert.deepEqual(view.badge, { label: "Connected", tone: "ok" });
  assert.equal(view.showReconnect, false);
  assert.equal(view.message, null);
});

test("googleHealthView: connected but revoked is amber 'Needs reconnect' with a Reconnect action", () => {
  const view = googleHealthView({ connected: true, needsReconnect: true, reason: "Google access was revoked or expired. Reconnect Google." });
  assert.equal(view.state, "needs_reconnect");
  assert.deepEqual(view.badge, { label: "Needs reconnect", tone: "warn" });
  assert.equal(view.showReconnect, true);
  assert.match(view.message ?? "", /revoked or expired/);
  assert.equal(googleHealthView({ connected: true, needs_reconnect: true }).message, RECONNECT_TEXT);
});

test("googleHealthView: reads exactly what the server's buildGoogleConnectionStatus emits", () => {
  const revoked = buildGoogleConnectionStatus({
    connected: true,
    health: { status: "needs_reconnect", lastErrorCode: "invalid_grant", lastErrorAt: null },
    hasProperty: true,
    lastSyncAt: null,
  });
  assert.equal(googleHealthView(revoked).state, "needs_reconnect");
  const healthy = buildGoogleConnectionStatus({ connected: true, health: { status: "ok", lastErrorCode: null, lastErrorAt: null }, hasProperty: true, lastSyncAt: null });
  assert.equal(googleHealthView(healthy).state, "connected");
  const noProperty = buildGoogleConnectionStatus({ connected: true, health: null, hasProperty: false, lastSyncAt: null });
  const view = googleHealthView(noProperty);
  assert.equal(view.state, "connected");
  assert.match(view.message ?? "", /No Search Console property/);
});

test("googleReconnectHref: one existing connect route, dashboard return only when asked", () => {
  assert.equal(googleReconnectHref("settings"), "/api/auth/google-analytics/connect");
  assert.equal(googleReconnectHref("dashboard"), "/api/auth/google-analytics/connect?return=dashboard");
});

test("referralNotice: needs-reconnect wins over the misleading 'Connect Google Analytics in Settings'", () => {
  const revoked = googleHealthView({ connected: true, needsReconnect: true });
  for (const kind of ["not_connected", "unavailable"] as const) {
    assert.deepEqual(referralNotice(revoked, kind), { text: RECONNECT_TEXT, showReconnect: true });
  }
});

test("referralNotice: real data is never replaced by a notice, even if health is bad", () => {
  assert.equal(referralNotice(googleHealthView({ connected: true, needsReconnect: true }), "ok"), null);
  assert.equal(referralNotice(googleHealthView({ connected: true }), "ok"), null);
});

test("referralNotice: connected-but-no-property no longer says 'connect in Settings'", () => {
  const connected = referralNotice(googleHealthView({ connected: true }), "not_connected");
  assert.match(connected?.text ?? "", /Choose a Google Analytics property/);
  assert.equal(connected?.showReconnect, false);
  assert.match(referralNotice(googleHealthView({ connected: false }), "not_connected")?.text ?? "", /Connect Google Analytics in Settings/);
  assert.match(referralNotice(googleHealthView({ connected: true }), "unavailable")?.text ?? "", /could not read/);
});

test("doneLineType: a warning line is an error, not a green success", () => {
  assert.equal(doneLineType("⚠ Google didn't accept the saved connection."), "error");
  assert.equal(doneLineType("  ⚠ spaced"), "error");
  assert.equal(doneLineType("Traffic data loaded — 12 clicks over the last 28 days."), "done");
});

// ---- null-safe traffic view model, shaped like the real error response (QA-1 bug 1) ----
test("buildTrafficView: the revoked-token response renders reconnect text, no cards, no throw", () => {
  const response = {
    range: { startDate: "2026-09-21", endDate: "2026-10-18" },
    site: "sc-domain:marlo.mlforge.in",
    status: "error" as const,
    reason: "Google didn't accept the saved connection. Reconnect Google in Settings to see this data.",
    needs_reconnect: true,
    totals: null,
    search: null,
    byDate: [],
    gscError: "Token has been expired or revoked",
  };
  const view = buildTrafficView(response);
  assert.equal(view.kind, "error");
  assert.deepEqual(view.cards, []);
  assert.equal(view.showReconnect, true);
  assert.doesNotMatch(view.message ?? "", /Cannot read properties/);
});

test("buildTrafficView: status ok but totals null/undefined degrades to 'No data yet', never dereferences", () => {
  for (const totals of [null, undefined]) {
    const view = buildTrafficView({ status: "ok", totals });
    assert.equal(view.kind, "no_data");
    assert.match(view.message ?? "", /No data yet/);
    assert.deepEqual(view.cards, []);
  }
});

test("buildTrafficView: camelCase needsReconnect is honoured too, and only for errors", () => {
  assert.equal(buildTrafficView({ status: "error", needsReconnect: true, totals: null }).showReconnect, true);
  assert.equal(buildTrafficView({ status: "no_data", needsReconnect: true, totals: null }).showReconnect, false);
});
