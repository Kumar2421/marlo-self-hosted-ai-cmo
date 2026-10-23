import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_SCOPE,
  SEARCH_CONSOLE_SCOPE,
  googleConnectHref,
  googleServiceRows,
  parseGrantedServices,
  parseServiceParam,
  resolveGrant,
  scopesForServices,
  serviceParamFor,
} from "../lib/googleOAuthScopes.ts";

test("service param: missing or unknown asks for both (backward compatible), known asks for one", () => {
  assert.deepEqual(parseServiceParam(null), ["search-console", "analytics"]);
  assert.deepEqual(parseServiceParam("nonsense"), ["search-console", "analytics"]);
  assert.deepEqual(parseServiceParam("search-console"), ["search-console"]);
  assert.deepEqual(parseServiceParam("analytics"), ["analytics"]);
  assert.equal(serviceParamFor(["analytics"]), "analytics");
  assert.deepEqual(parseServiceParam(serviceParamFor(["search-console", "analytics"])), ["search-console", "analytics"]);
});

test("each connect asks only for its own scope", () => {
  const gsc = scopesForServices(["search-console"]).split(" ");
  assert.ok(gsc.includes(SEARCH_CONSOLE_SCOPE));
  assert.ok(!gsc.includes(ANALYTICS_SCOPE));
  const ga = scopesForServices(["analytics"]).split(" ");
  assert.ok(ga.includes(ANALYTICS_SCOPE));
  assert.ok(!ga.includes(SEARCH_CONSOLE_SCOPE));
  const both = scopesForServices(["search-console", "analytics"]).split(" ");
  assert.ok(both.includes(ANALYTICS_SCOPE) && both.includes(SEARCH_CONSOLE_SCOPE));
});

test("granted scopes are read per service; unreadable scopes claim nothing", () => {
  assert.deepEqual(parseGrantedServices([SEARCH_CONSOLE_SCOPE, "openid"]), {
    known: true,
    granted: { "search-console": true, analytics: false },
  });
  assert.equal(parseGrantedServices(null).known, false);
  assert.equal(parseGrantedServices([]).known, false);
});

test("full grant connects what was asked and reports no problem", () => {
  const out = resolveGrant(["search-console", "analytics"], parseGrantedServices([SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE]));
  assert.deepEqual(out.connect, ["search-console", "analytics"]);
  assert.equal(out.message, null);
});

test("partial grant (one box unticked) connects only the granted one and says so", () => {
  const out = resolveGrant(["search-console", "analytics"], parseGrantedServices([SEARCH_CONSOLE_SCOPE]));
  assert.deepEqual(out.connect, ["search-console"]);
  assert.deepEqual(out.missing, ["analytics"]);
  assert.match(out.message ?? "", /Analytics permission was not granted/);
  assert.match(out.message ?? "", /Search Console is connected/);
});

test("nothing granted connects nothing", () => {
  const out = resolveGrant(["analytics"], parseGrantedServices([SEARCH_CONSOLE_SCOPE]));
  assert.deepEqual(out.connect, []);
  assert.match(out.message ?? "", /Analytics permission was not granted/);
});

test("connecting one service ignores a service that was not requested, even if granted earlier", () => {
  const out = resolveGrant(["analytics"], parseGrantedServices([SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE]));
  assert.deepEqual(out.connect, ["analytics"]);
  assert.equal(out.message, null);
});

test("unreadable grant trusts only the requested services", () => {
  const out = resolveGrant(["search-console"], parseGrantedServices(null));
  assert.deepEqual(out.connect, ["search-console"]);
  assert.equal(out.message, null);
});

test("rows: a user with only Search Console sees Analytics as not connected", () => {
  const rows = googleServiceRows(["google-search-console"], false);
  assert.deepEqual(rows.map((r) => [r.service, r.state, r.action]), [
    ["search-console", "connected", null],
    ["analytics", "not_connected", "Connect"],
  ]);
});

test("rows: already-connected users (both rows) stay connected; needs-reconnect offers Reconnect only where connected", () => {
  assert.ok(googleServiceRows(["google-search-console", "google-analytics"], false).every((r) => r.state === "connected"));
  const rows = googleServiceRows(["google-analytics"], true);
  assert.deepEqual(rows.map((r) => [r.state, r.action]), [["not_connected", "Connect"], ["needs_reconnect", "Reconnect"]]);
  assert.ok(googleServiceRows(undefined, false).every((r) => r.state === "not_connected"));
});

test("connect links carry the service; the Settings link (both) stays unchanged", () => {
  assert.equal(googleConnectHref("analytics"), "/api/auth/google-analytics/connect?return=dashboard&service=analytics");
  assert.equal(googleConnectHref("both", "dashboard"), "/api/auth/google-analytics/connect?return=dashboard");
  assert.equal(googleConnectHref("both", "settings"), "/api/auth/google-analytics/connect");
});
