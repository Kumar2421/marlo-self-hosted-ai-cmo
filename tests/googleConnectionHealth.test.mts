import test from "node:test";
import assert from "node:assert/strict";
import {
  GoogleAuthError,
  envValue,
  needsReconnect,
  parseGoogleApiError,
  parseGoogleTokenError,
} from "../lib/domain/shared/googleAuthError.ts";
import { discoverGoogleResources, listSearchConsoleSites, refreshAccessToken } from "../lib/domain/shared/googleAnalyticsOAuth.ts";
import { GA4_SCOPE, GSC_SCOPE, checkGoogleServiceScopes } from "../lib/domain/integrations/googleScopes.ts";
import { chooseSelectedResourceId } from "../lib/domain/integrations/resourceSelection.ts";
import { buildGoogleConnectionStatus, worstHealth } from "../lib/domain/integrations/connectionStatus.ts";
import { selectDueProjects, skippedTargets } from "../lib/domain/search/dueProjects.ts";
import { dataFreshness } from "../lib/domain/search/dataFreshness.ts";

// --- typed token errors (sample bodies as Google returns them) ---

test("token error: invalid_client body becomes a typed invalid_client", () => {
  const err = parseGoogleTokenError(401, '{"error":"invalid_client","error_description":"The OAuth client was not found."}');
  assert.ok(err instanceof GoogleAuthError);
  assert.equal(err.code, "invalid_client");
  assert.equal(err.status, 401);
  assert.match(err.message, /OAuth client was not found/);
  assert.equal(needsReconnect(err.code), true);
});

test("token error: unauthorized_client is treated as invalid_client; invalid_grant is its own code", () => {
  assert.equal(parseGoogleTokenError(400, '{"error":"unauthorized_client"}').code, "invalid_client");
  const grant = parseGoogleTokenError(400, '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}');
  assert.equal(grant.code, "invalid_grant");
  assert.equal(needsReconnect(grant.code), true);
});

test("token error: scope refusals map to insufficient_scope; junk bodies map to unknown and do not need reconnect", () => {
  assert.equal(parseGoogleTokenError(400, '{"error":"invalid_scope"}').code, "insufficient_scope");
  const html = parseGoogleTokenError(502, "<html>Bad gateway</html>");
  assert.equal(html.code, "unknown");
  assert.equal(needsReconnect(html.code), false);
  assert.doesNotMatch(html.message, /html/i);
});

test("api error: 401 is a dead token, 403 is a missing permission or disabled API", () => {
  assert.equal(parseGoogleApiError(401, '{"error":{"code":401,"message":"Invalid Credentials"}}').code, "invalid_grant");
  const forbidden = parseGoogleApiError(403, '{"error":{"code":403,"message":"Google Analytics Admin API has not been used in project 1 before or it is disabled."}}');
  assert.equal(forbidden.code, "insufficient_scope");
  assert.match(forbidden.message, /disabled/);
  assert.equal(parseGoogleApiError(500, "oops").code, "unknown");
});

// --- env trimming and token request (fetch stubbed) ---

type FetchCall = { url: string; body: string };
function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), body: String(init?.body ?? "") };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("envValue trims trailing newline and spaces", () => {
  assert.equal(envValue("abc.apps.googleusercontent.com\n"), "abc.apps.googleusercontent.com");
  assert.equal(envValue("  secret \r\n"), "secret");
  assert.equal(envValue(undefined), "");
});

test("refresh sends trimmed client id/secret and surfaces a typed error without echoing the secret", async () => {
  const saved = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET };
  process.env.GMAIL_CLIENT_ID = "client-id\n";
  process.env.GMAIL_CLIENT_SECRET = " TOP-SECRET-VALUE \n";
  const stub = stubFetch(() => new Response('{"error":"invalid_client","error_description":"Unauthorized"}', { status: 401 }));
  try {
    await assert.rejects(
      () => refreshAccessToken("refresh-token-123"),
      (err: unknown) => {
        assert.ok(err instanceof GoogleAuthError);
        assert.equal(err.code, "invalid_client");
        assert.ok(!err.message.includes("TOP-SECRET-VALUE"));
        assert.ok(!err.message.includes("refresh-token-123"));
        return true;
      },
    );
    const sent = new URLSearchParams(stub.calls[0].body);
    assert.equal(sent.get("client_id"), "client-id");
    assert.equal(sent.get("client_secret"), "TOP-SECRET-VALUE");
  } finally {
    stub.restore();
    process.env.GMAIL_CLIENT_ID = saved.id;
    process.env.GMAIL_CLIENT_SECRET = saved.secret;
  }
});

test("refresh: a network failure is a typed 'network' error", async () => {
  process.env.GMAIL_CLIENT_ID = "id";
  process.env.GMAIL_CLIENT_SECRET = "secret";
  const stub = stubFetch(() => { throw new TypeError("fetch failed: secret=secret"); });
  try {
    await assert.rejects(
      () => refreshAccessToken("r"),
      (err: unknown) => err instanceof GoogleAuthError && err.code === "network" && !err.message.includes("secret=secret"),
    );
  } finally {
    stub.restore();
  }
});

// --- listing no longer swallows errors ---

test("listSearchConsoleSites: a 403 throws instead of returning an empty list; a real empty account returns []", async () => {
  let stub = stubFetch(() => new Response('{"error":{"code":403,"message":"Forbidden"}}', { status: 403 }));
  try {
    await assert.rejects(() => listSearchConsoleSites("t"), (err: unknown) => err instanceof GoogleAuthError && err.code === "insufficient_scope");
  } finally { stub.restore(); }
  stub = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    assert.deepEqual(await listSearchConsoleSites("t"), []);
  } finally { stub.restore(); }
});

test("discoverGoogleResources: ungranted Search Console is reported and not called; GA4 still lists", async () => {
  const stub = stubFetch((call) =>
    call.url.includes("analyticsadmin")
      ? new Response('{"accountSummaries":[{"propertySummaries":[{"property":"properties/1","displayName":"Site"}]}]}', { status: 200 })
      : new Response("{}", { status: 200 }),
  );
  try {
    const result = await discoverGoogleResources("t", [GA4_SCOPE]);
    assert.equal(result.gscListed, false);
    assert.equal(result.ga4Listed, true);
    assert.deepEqual(result.ga4Properties, [{ id: "properties/1", name: "Site" }]);
    assert.deepEqual(result.problems, ["Search Console permission not granted: reconnect and tick it."]);
    assert.ok(!stub.calls.some((c) => c.url.includes("webmasters")));
  } finally { stub.restore(); }
});

test("discoverGoogleResources: a failing listing is a problem and is not marked listed (stored selection is kept)", async () => {
  const stub = stubFetch((call) =>
    call.url.includes("webmasters")
      ? new Response('{"error":{"message":"Search Console API has not been used"}}', { status: 403 })
      : new Response('{"accountSummaries":[]}', { status: 200 }),
  );
  try {
    const result = await discoverGoogleResources("t", null);
    assert.equal(result.gscListed, false);
    assert.equal(result.ga4Listed, true);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /Search Console/);
  } finally { stub.restore(); }
});

// --- scope check ---

test("scope check: both present, one missing, none, and unknown", () => {
  assert.equal(checkGoogleServiceScopes([GSC_SCOPE, GA4_SCOPE, "email"]).problem, null);
  assert.equal(checkGoogleServiceScopes([GA4_SCOPE]).problem, "Search Console permission not granted: reconnect and tick it.");
  assert.match(checkGoogleServiceScopes([GSC_SCOPE]).problem ?? "", /Google Analytics permission not granted/);
  const none = checkGoogleServiceScopes(["email"]);
  assert.equal(none.gsc || none.ga4, false);
  assert.match(none.problem ?? "", /Search Console permission not granted.*Google Analytics permission not granted/);
  const unknown = checkGoogleServiceScopes(null);
  assert.equal(unknown.known, false);
  assert.equal(unknown.problem, null);
});

// --- selection preservation ---

test("reconnect keeps the previously selected resource when it still exists", () => {
  assert.equal(chooseSelectedResourceId(["a", "b", "c"], "b"), "b");
});

test("selection: dropped previous pick falls back to none (several) or the only one; explicit choice wins", () => {
  assert.equal(chooseSelectedResourceId(["a", "c"], "b"), null);
  assert.equal(chooseSelectedResourceId(["only"], "gone"), "only");
  assert.equal(chooseSelectedResourceId(["a", "b"], "a", "b"), "b");
  assert.equal(chooseSelectedResourceId([], "a"), null);
});

// --- due ordering ---

const target = (projectId: string, extra: Record<string, unknown> = {}) => ({ projectId, userId: "u", ...extra });

test("due projects are ordered by oldest capture, never-captured first, ties by id", () => {
  const last = new Map([
    ["p-new", "2026-10-20T03:00:00Z"],
    ["p-old", "2026-10-10T03:00:00Z"],
  ]);
  const due = selectDueProjects([target("p-new"), target("p-old"), target("p-never-b"), target("p-never-a")], new Set(), last);
  assert.deepEqual(due.map((t) => t.projectId), ["p-never-a", "p-never-b", "p-old", "p-new"]);
});

test("a project that failed today keeps its old capture time and does not jump ahead of ones that waited longer", () => {
  const last = new Map([
    ["a-failing", "2026-10-19T03:00:00Z"],
    ["z-waiting", "2026-10-12T03:00:00Z"],
  ]);
  const due = selectDueProjects([target("a-failing"), target("z-waiting")], new Set(), last);
  assert.equal(due[0].projectId, "z-waiting");
});

test("due projects skip needs_reconnect and no-property connections and report why", () => {
  const connected = [
    target("ok", { status: "connected", hasProperty: true }),
    target("revoked", { status: "needs_reconnect", hasProperty: true }),
    target("no-site", { status: "connected", hasProperty: false }),
    target("unknown-property", {}),
    target("done", { status: "needs_reconnect" }),
  ];
  const doneToday = new Set(["done"]);
  assert.deepEqual(selectDueProjects(connected, doneToday).map((t) => t.projectId), ["ok", "unknown-property"]);
  assert.deepEqual(skippedTargets(connected, doneToday), [
    { projectId: "revoked", reason: "needs_reconnect" },
    { projectId: "no-site", reason: "no_property" },
  ]);
});

// --- status builder ---

test("status: not connected, healthy, needs reconnect, and no property", () => {
  const sync = "2026-10-20T03:00:00Z";
  assert.deepEqual(buildGoogleConnectionStatus({ connected: false, health: null, hasProperty: null, lastSyncAt: null }), {
    connected: false, needsReconnect: false, reason: null, lastSyncAt: null,
  });
  assert.deepEqual(buildGoogleConnectionStatus({ connected: true, health: { status: "connected", lastErrorCode: null, lastErrorAt: null }, hasProperty: true, lastSyncAt: sync }), {
    connected: true, needsReconnect: false, reason: null, lastSyncAt: sync,
  });
  const broken = buildGoogleConnectionStatus({
    connected: true,
    health: { status: "needs_reconnect", lastErrorCode: "invalid_grant", lastErrorAt: sync },
    hasProperty: true,
    lastSyncAt: sync,
  });
  assert.equal(broken.needsReconnect, true);
  assert.match(broken.reason ?? "", /revoked or expired/);
  const client = buildGoogleConnectionStatus({ connected: true, health: { status: "needs_reconnect", lastErrorCode: "invalid_client", lastErrorAt: sync }, hasProperty: null, lastSyncAt: null });
  assert.match(client.reason ?? "", /OAuth client/);
  const noSite = buildGoogleConnectionStatus({ connected: true, health: null, hasProperty: false, lastSyncAt: null });
  assert.equal(noSite.needsReconnect, false);
  assert.match(noSite.reason ?? "", /No Search Console property/);
});

test("worstHealth prefers a needs_reconnect row", () => {
  const ok = { status: "connected", lastErrorCode: null, lastErrorAt: null };
  const bad = { status: "needs_reconnect", lastErrorCode: "invalid_grant", lastErrorAt: "x" };
  assert.equal(worstHealth([ok, bad]), bad);
  assert.equal(worstHealth([]), null);
});

// --- data freshness ---

test("dataFreshness: fresh up to 2 days, stale after, very_stale from 7 days or when unreadable", () => {
  const now = new Date("2026-10-21T10:00:00Z");
  assert.equal(dataFreshness("2026-10-21", now), "fresh");
  assert.equal(dataFreshness("2026-10-19", now), "fresh");
  assert.equal(dataFreshness("2026-10-18", now), "stale");
  assert.equal(dataFreshness("2026-10-15", now), "stale");
  assert.equal(dataFreshness("2026-10-14", now), "very_stale");
  assert.equal(dataFreshness("2026-10-12T03:00:00Z", now), "very_stale");
  assert.equal(dataFreshness("not a date", now), "very_stale");
  assert.equal(dataFreshness("2026-10-22", now), "fresh");
});
