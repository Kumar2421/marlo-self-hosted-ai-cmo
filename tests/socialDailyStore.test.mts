import test from "node:test";
import assert from "node:assert/strict";
import { claimSocialDay, fetchAllRows, releaseSocialDay, summarizeMarkers, type MarkerRow } from "../lib/domain/social/dailyDraftsStoreSupabase.ts";
import { DEFAULT_DAILY_DRAFT_SETTINGS, normalizeDailyDraftSettings, optedInProjectIds, parseDailyDraftSettings } from "../lib/domain/social/dailyDraftSettings.ts";

const NOW = new Date("2026-10-14T09:00:00Z");

test("fetchAllRows reads every page of 1000 and stops on a short page", async () => {
  const total = 2500;
  const ranges: Array<[number, number]> = [];
  const rows = await fetchAllRows<number>(async (from, to) => {
    ranges.push([from, to]);
    const data = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i);
    return { data, error: null };
  });
  assert.equal(rows.length, total);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(rows[2499], 2499);
});

test("fetchAllRows asks one more page after an exact page, then stops", async () => {
  let calls = 0;
  const rows = await fetchAllRows<number>(async (from, to) => {
    calls += 1;
    const data = from === 0 ? Array.from({ length: 1000 }, (_, i) => i) : [];
    assert.equal(to - from, 999);
    return { data, error: null };
  });
  assert.equal(rows.length, 1000);
  assert.equal(calls, 2);
});

test("fetchAllRows throws a fixed Error on a query error and keeps going no further", async () => {
  let calls = 0;
  await assert.rejects(
    fetchAllRows<number>(async () => {
      calls += 1;
      return { data: null, error: { message: "relation missing" } };
    }),
    /relation missing/,
  );
  assert.equal(calls, 1);
});

function marker(projectId: string, docType: string, updatedAt: string, content: string | null = "{}"): MarkerRow {
  return { project_id: projectId, doc_type: docType, updated_at: updatedAt, content };
}

test("markers: today's attempts, the last attempt time (any day) and the created total", () => {
  const rows: MarkerRow[] = [
    marker("p1", "social_daily_attempt:2026-10-14:x", "2026-10-14T08:00:00Z"),
    marker("p1", "social_daily_attempt:2026-10-14:linkedin", "2026-10-14T08:01:00Z"),
    marker("p1", "social_daily_done:2026-10-14:x", "2026-10-14T08:00:05Z", '{"created":2}'),
    marker("p1", "social_daily_done:2026-10-14:linkedin", "2026-10-14T08:01:05Z", '{"created":3}'),
    marker("p2", "social_daily_attempt:2026-10-13:x", "2026-10-13T08:00:00Z"),
    marker("p2", "social_daily_done:2026-10-13:x", "2026-10-13T08:00:05Z", '{"created":9}'),
    marker("p3", "social_daily_attempt:2026-10-12:reddit", "2026-10-14T07:00:00Z"),
    marker("p4", "social_daily_claim:2026-10-14", "2026-10-14T08:59:00Z", '{"token":"t"}'),
    marker("p4", "social_daily_settings", "2026-10-14T08:59:00Z", '{"x":false}'),
    marker("p4", "social_daily_attempt:2026-10-14:mastodon", "2026-10-14T08:59:00Z"),
  ];
  const s = summarizeMarkers(rows, NOW);
  assert.deepEqual([...(s.attemptedToday.get("p1") ?? [])].sort(), ["linkedin", "x"]);
  assert.equal(s.attemptedToday.has("p2"), false, "yesterday's attempts do not count today");
  assert.equal(s.attemptedToday.has("p4"), false, "unknown platforms are ignored");
  assert.equal(s.createdToday, 5, "only today's created counts, summed");
  assert.equal(s.lastAttempt.get("p1"), "2026-10-14T08:01:00Z");
  assert.equal(s.lastAttempt.get("p2"), "2026-10-13T08:00:00Z");
  assert.equal(s.lastAttempt.get("p3"), "2026-10-14T07:00:00Z", "rotation uses the last attempt, whatever its day");
  assert.equal(s.lastAttempt.has("p4"), false);
});

test("markers: a bad created count counts as zero", () => {
  const s = summarizeMarkers(
    [
      marker("p1", "social_daily_done:2026-10-14:x", "2026-10-14T08:00:00Z", "not json"),
      marker("p1", "social_daily_done:2026-10-14:linkedin", "2026-10-14T08:00:00Z", '{"created":"lots"}'),
      marker("p1", "social_daily_done:2026-10-14:reddit", "2026-10-14T08:00:00Z", '{"created":-4}'),
    ],
    NOW,
  );
  assert.equal(s.createdToday, 0);
});

type Call = { table: string; method: string; args: unknown[] };

/** A recording fake of the Supabase chain. `results` maps a write method (insert, update, delete) to what it resolves to. */
function fakeDb(results: Partial<Record<"insert" | "update" | "delete", unknown>>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      let mode = "";
      const builder: unknown = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === "then") {
              const resolved = (mode && results[mode as "insert"]) || { data: null, error: null };
              return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(resolved).then(ok, bad);
            }
            return (...args: unknown[]) => {
              calls.push({ table, method: prop, args });
              if (prop === "insert" || prop === "update" || prop === "delete" || prop === "upsert") mode = prop;
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { db: db as never, calls };
}

test("claim: a fresh insert returns this run's token", async () => {
  const { db, calls } = fakeDb({ insert: { data: null, error: null } });
  const token = await claimSocialDay(db, "u1", "p1", "2026-10-14", NOW);
  assert.equal(typeof token, "string");
  assert.ok((token ?? "").length > 10);
  const insert = calls.find((c) => c.method === "insert");
  assert.deepEqual((insert?.args[0] as { content: string }).content, JSON.stringify({ token }));
});

test("claim: a held fresh claim returns null", async () => {
  const { db } = fakeDb({
    insert: { data: null, error: { code: "23505", message: "duplicate" } },
    update: { data: [], error: null },
  });
  assert.equal(await claimSocialDay(db, "u1", "p1", "2026-10-14", NOW), null);
});

test("claim: a stale claim is taken over with a new token", async () => {
  const { db, calls } = fakeDb({
    insert: { data: null, error: { code: "23505", message: "duplicate" } },
    update: { data: [{ project_id: "p1" }], error: null },
  });
  const token = await claimSocialDay(db, "u1", "p1", "2026-10-14", NOW);
  assert.equal(typeof token, "string");
  const update = calls.find((c) => c.method === "update");
  assert.deepEqual((update?.args[0] as { content: string }).content, JSON.stringify({ token }));
});

test("claim: a non-duplicate insert error is thrown, not treated as held", async () => {
  const { db } = fakeDb({ insert: { data: null, error: { code: "08000", message: "connection lost" } } });
  await assert.rejects(claimSocialDay(db, "u1", "p1", "2026-10-14", NOW), /connection lost/);
});

test("release: deletes only the row whose content is this run's token", async () => {
  const { db, calls } = fakeDb({ delete: { data: null, error: null } });
  await releaseSocialDay(db, "u1", "p1", "2026-10-14", "tok-A");
  const eqs = calls.filter((c) => c.method === "eq").map((c) => c.args);
  assert.ok(eqs.some((a) => a[0] === "content" && a[1] === JSON.stringify({ token: "tok-A" })));
  assert.ok(eqs.some((a) => a[0] === "doc_type" && a[1] === "social_daily_claim:2026-10-14"));
});

test("settings: missing or malformed content gives all networks off (opt-in)", () => {
  const off = { x: false, linkedin: false, reddit: false };
  assert.deepEqual(DEFAULT_DAILY_DRAFT_SETTINGS, off);
  assert.deepEqual(parseDailyDraftSettings(null), off);
  assert.deepEqual(parseDailyDraftSettings("{not json"), off);
  assert.deepEqual(normalizeDailyDraftSettings(null), off);
  assert.deepEqual(normalizeDailyDraftSettings([1, 2]), off);
});

test("settings: only real booleans are read; anything else keeps the default off", () => {
  assert.deepEqual(normalizeDailyDraftSettings({ x: true, linkedin: "yes", reddit: 1 }), { x: true, linkedin: false, reddit: false });
  assert.deepEqual(normalizeDailyDraftSettings({ x: false, linkedin: true, reddit: false, extra: true }), { x: false, linkedin: true, reddit: false });
});

test("settings: existing explicit settings keep their values", () => {
  assert.deepEqual(parseDailyDraftSettings('{"x":true,"linkedin":true,"reddit":true}'), { x: true, linkedin: true, reddit: true });
  assert.deepEqual(parseDailyDraftSettings('{"x":true,"linkedin":false,"reddit":true}'), { x: true, linkedin: false, reddit: true });
});

test("opt-in: only projects with a saved row and a network on are drafted for", () => {
  const ids = optedInProjectIds([
    { project_id: "never-saved-is-absent", content: null },
    { project_id: "all-off", content: '{"x":false,"linkedin":false,"reddit":false}' },
    { project_id: "garbage", content: "{nope" },
    { project_id: "one-on", content: '{"x":false,"linkedin":true,"reddit":false}' },
    { project_id: "all-on", content: '{"x":true,"linkedin":true,"reddit":true}' },
  ]);
  assert.deepEqual([...ids].sort(), ["all-on", "one-on"]);
  assert.equal(optedInProjectIds([]).size, 0, "a user with no settings row is never drafted for");
});
