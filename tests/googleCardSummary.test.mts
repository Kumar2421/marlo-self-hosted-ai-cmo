import test from "node:test";
import assert from "node:assert/strict";
import { buildGoogleCardSummary, syncLabel } from "../lib/domain/integrations/googleCardSummary.ts";
import { googleHealthView } from "../lib/domain/integrations/googleHealthView.ts";

const NOW = new Date("2026-10-21T12:00:00Z");
const account = { connectedHere: true, canReuse: false, email: "a@b.test" };
const selected = { site: "sc-domain:acme.test", property: "Acme GA4" };

test("syncLabel is honest when there is no usable date", () => {
  assert.equal(syncLabel(null, NOW), "Not synced yet");
  assert.equal(syncLabel("nonsense", NOW), "Not synced yet");
  assert.equal(syncLabel("2026-10-21T01:00:00Z", NOW), "Synced today");
  assert.equal(syncLabel("2026-10-20T01:00:00Z", NOW), "Synced yesterday");
  assert.equal(syncLabel("2026-10-18T12:00:00Z", NOW), "Synced 3 days ago");
});

test("not connected is a single connect row", () => {
  const s = buildGoogleCardSummary({
    health: googleHealthView({ connected: false }),
    account: { connectedHere: false, canReuse: true, email: "a@b.test" },
    selected: { site: null, property: null },
    ready: false,
  });
  assert.deepEqual(s, { mode: "connect", canReuse: true, email: "a@b.test" });
});

test("connected and chosen collapses to a one-line summary with the last sync", () => {
  const s = buildGoogleCardSummary({
    health: googleHealthView({ connected: true, lastSyncAt: "2026-10-18T12:00:00Z" }),
    account,
    selected,
    ready: true,
    now: NOW,
  });
  assert.equal(s.mode, "summary");
  if (s.mode !== "summary") return;
  assert.equal(s.tone, "ok");
  assert.equal(s.site, "sc-domain:acme.test");
  assert.equal(s.syncLabel, "Synced 3 days ago");
  assert.equal(s.message, null);
  assert.equal(s.showReconnect, false);
});

test("needs reconnect uses the shared helper's message and shows the reconnect action", () => {
  const s = buildGoogleCardSummary({
    health: googleHealthView({ connected: true, needsReconnect: true, reason: null }),
    account,
    selected,
    ready: true,
    now: NOW,
  });
  assert.equal(s.mode, "summary");
  if (s.mode !== "summary") return;
  assert.equal(s.tone, "warn");
  assert.equal(s.message, "Google connection needs to be reconnected.");
  assert.equal(s.showReconnect, true);
  assert.equal(s.syncLabel, "Not synced yet");
});

test("connected but a site still has to be chosen keeps the full card", () => {
  const s = buildGoogleCardSummary({
    health: googleHealthView({ connected: true }),
    account,
    selected: { site: null, property: null },
    ready: false,
  });
  assert.deepEqual(s, { mode: "full" });
});

test("the shared helper carries lastSyncAt only when connected", () => {
  assert.equal(googleHealthView({ connected: true, lastSyncAt: "2026-10-18T00:00:00Z" }).lastSyncAt, "2026-10-18T00:00:00Z");
  assert.equal(googleHealthView({ connected: false, lastSyncAt: "2026-10-18T00:00:00Z" }).lastSyncAt, null);
  assert.equal(googleHealthView(null).lastSyncAt, null);
});
