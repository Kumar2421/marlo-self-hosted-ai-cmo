import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKLOG_LIMIT, GENERATION_FAILED, SOCIAL_PLATFORMS, runDailyDrafts, rotationOrder, skipReasonFor,
  socialDraftsNotice, notifySocialDrafts, UNEXPECTED,
  type DailyDraftPorts, type DailyDraftSnapshot,
} from "../lib/domain/social/dailyDrafts.ts";
import type { PlatformId } from "../lib/domain/social/platforms.ts";
import { MemoryNotificationStore } from "../lib/domain/notifications/fakes.ts";
import { defaultPrefs, emailDecision } from "../lib/domain/notifications/preferences.ts";
import { socialDraftsTitle } from "../lib/domain/notifications/render.ts";
import { linkedInPrompt, redditPrompt } from "../lib/domain/social/platformPrompts.ts";

const NOW = new Date("2026-10-14T09:00:00Z");
const READY: DailyDraftSnapshot = { hasProductInfo: true, subreddit: "startups", modelAccess: "byok", creditsAffordable: true };

type Outcome = number | "throw";

/** In-memory ports. `result` is the status generate() returns per network (default 201). `done` seeds markers as "day:platform". */
function fakePorts(opts: {
  snap?: Partial<DailyDraftSnapshot>;
  pending?: Partial<Record<PlatformId, number>>;
  result?: Partial<Record<PlatformId, Outcome>>;
  claim?: boolean;
  done?: string[];
} = {}) {
  const calls: PlatformId[] = [];
  const done = new Set(opts.done ?? []);
  let released = 0;
  const ports: DailyDraftPorts = {
    claimDay: async () => opts.claim ?? true,
    releaseDay: async () => {
      released += 1;
    },
    isDone: async (platform, day) => done.has(`${day}:${platform}`),
    markDone: async (platform, day) => {
      done.add(`${day}:${platform}`);
    },
    snapshot: async () => ({ ...READY, ...opts.snap }),
    pendingCount: async (platform) => opts.pending?.[platform] ?? 0,
    generate: async (platform) => {
      calls.push(platform);
      const outcome = opts.result?.[platform] ?? 201;
      if (outcome === "throw") throw new Error("boom: secret-ish internals");
      if (outcome === 201) return { status: 201, body: { drafts: [{ id: `${platform}-1` }] } };
      return { status: outcome, body: { error: "x" } };
    },
  };
  return { ports, calls, done, released: () => released };
}

test("one draft per network: all three run and are marked done", async () => {
  const f = fakePorts();
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(f.calls, ["x", "linkedin", "reddit"]);
  assert.deepEqual(s.created, { x: 1, linkedin: 1, reddit: 1 });
  assert.equal(f.done.size, 3);
  assert.deepEqual(s.errors, []);
  assert.equal(f.released(), 1);
});

test("reddit needs a saved subreddit; the other networks still run", async () => {
  const f = fakePorts({ snap: { subreddit: null } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(f.calls, ["x", "linkedin"]);
  assert.deepEqual(s.skipped, [{ platform: "reddit", reason: "no_subreddit" }]);
  assert.ok(f.done.has("2026-10-14:reddit"), "a legitimate skip is marked done");
});

test("no product info: nothing is generated", async () => {
  const f = fakePorts({ snap: { hasProductInfo: false } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(f.calls, []);
  assert.equal(s.skipped.filter((x) => x.reason === "no_product_info").length, 3);
});

test("no model key at all: skipped as a configuration state", () => {
  assert.equal(skipReasonFor("x", { ...READY, modelAccess: "none" }), "no_model_key");
});

test("out of credits on the platform key: skipped before any model call", async () => {
  const f = fakePorts({ snap: { modelAccess: "platform", creditsAffordable: false } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(f.calls, []);
  assert.equal(s.skipped.filter((x) => x.reason === "out_of_credits").length, 3);
});

test("out of credits is not checked for the user's own key (BYOK)", () => {
  assert.equal(skipReasonFor("x", { ...READY, modelAccess: "byok", creditsAffordable: false }), null);
});

test("a 402 from generate is a legitimate skip and is marked done", async () => {
  const f = fakePorts({ result: { x: 402 } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.ok(s.skipped.some((x) => x.platform === "x" && x.reason === "out_of_credits"));
  assert.ok(f.done.has("2026-10-14:x"));
});

test("backlog guard: six or more unreviewed drafts block a new one", () => {
  assert.equal(BACKLOG_LIMIT, 6);
  assert.equal(skipReasonFor("linkedin", READY, 6), "backlog");
  assert.equal(skipReasonFor("linkedin", READY, 5), null);
});

test("backlog guard end to end: only the full network is skipped", async () => {
  const f = fakePorts({ pending: { x: 6, linkedin: 2 } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(f.calls, ["linkedin", "reddit"]);
  assert.deepEqual(s.skipped, [{ platform: "x", reason: "backlog" }]);
});

test("daily limit: a refused slot (429) is a legitimate skip and is marked done", async () => {
  const f = fakePorts({ result: { reddit: 429 } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.ok(s.skipped.some((x) => x.platform === "reddit" && x.reason === "daily_limit"));
  assert.ok(f.done.has("2026-10-14:reddit"));
});

test("idempotent rerun: a second run the same day generates nothing", async () => {
  const first = fakePorts();
  await runDailyDrafts(first.ports, NOW);
  const second = fakePorts({ done: [...first.done] });
  const s = await runDailyDrafts(second.ports, NOW);
  assert.deepEqual(second.calls, []);
  assert.equal(s.skipped.filter((x) => x.reason === "already_done").length, 3);
});

test("a new UTC day runs again", async () => {
  const f = fakePorts({ done: ["2026-10-14:x", "2026-10-14:linkedin", "2026-10-14:reddit"] });
  await runDailyDrafts(f.ports, new Date("2026-10-15T00:30:00Z"));
  assert.deepEqual(f.calls, ["x", "linkedin", "reddit"]);
});

test("transient error (502) is reported and NOT marked done, so it retries", async () => {
  const f = fakePorts({ result: { x: 502 } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(s.errors, [{ platform: "x", error: GENERATION_FAILED }]);
  assert.equal(f.done.has("2026-10-14:x"), false);

  const retry = fakePorts({ done: [...f.done] });
  await runDailyDrafts(retry.ports, NOW);
  assert.deepEqual(retry.calls, ["x"]);
});

test("an unexpected throw is a fixed message, never the raw error, and is not marked done", async () => {
  const f = fakePorts({ result: { linkedin: "throw" } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(s.errors, [{ platform: "linkedin", error: UNEXPECTED }]);
  assert.equal(JSON.stringify(s).includes("secret-ish"), false);
  assert.equal(f.done.has("2026-10-14:linkedin"), false);
  assert.ok(f.done.has("2026-10-14:x"), "other networks still finish");
});

test("a held claim means another run is working: nothing is done", async () => {
  const f = fakePorts({ claim: false });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.equal(s.busy, true);
  assert.deepEqual(f.calls, []);
  assert.equal(f.released(), 0);
});

test("the time budget stops between networks and leaves the rest for the next run", async () => {
  const f = fakePorts();
  let polls = 0;
  const s = await runDailyDrafts(f.ports, NOW, { timeUp: () => polls++ >= 1 });
  assert.equal(s.interrupted, true);
  assert.deepEqual(f.calls, ["x"]);
  assert.equal(f.released(), 1);
});

test("notification: only when at least one draft was created", () => {
  assert.equal(socialDraftsNotice({ userId: "u1", projectId: "p1", day: "2026-10-14", created: { x: 0, linkedin: 0, reddit: 0 } }), null);
  const n = socialDraftsNotice({ userId: "u1", projectId: "p1", day: "2026-10-14", created: { x: 1, linkedin: 0, reddit: 1 } });
  assert.ok(n);
  assert.equal(n.kind, "social_drafts_ready");
  assert.equal(n.dedupeKey, "social_drafts_ready:u1:2026-10-14");
  assert.deepEqual(n.payload, { open: "social", platform: "x", created: { x: 1, linkedin: 0, reddit: 1 }, projectId: "p1" });
});

test("notification title: singular and plural", () => {
  assert.equal(socialDraftsTitle(1), "1 new social draft is ready");
  assert.equal(socialDraftsTitle(3), "3 new social drafts are ready");
});

test("notifySocialDrafts stores one in-app item, and a rerun the same day is a no-op", async () => {
  const store = new MemoryNotificationStore();
  const input = { projectId: "p1", day: "2026-10-14", created: { x: 1, linkedin: 1, reddit: 1 } };
  const first = await notifySocialDrafts(store, "u1", input, NOW);
  const second = await notifySocialDrafts(store, "u1", input, NOW);
  assert.equal(first.notified, true);
  assert.equal(second.notified, false);
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].title, "3 new social drafts are ready");
});

test("notifySocialDrafts stores nothing when no drafts were created", async () => {
  const store = new MemoryNotificationStore();
  const r = await notifySocialDrafts(store, "u1", { projectId: "p1", day: "2026-10-14", created: {} }, NOW);
  assert.equal(r.notified, false);
  assert.equal(store.rows.length, 0);
});

test("notifySocialDrafts respects the user's content category being off", async () => {
  const store = new MemoryNotificationStore();
  const prefs = defaultPrefs();
  prefs.categories.content = "off";
  await store.savePreferences("u1", prefs);
  const r = await notifySocialDrafts(store, "u1", { projectId: "p1", day: "2026-10-14", created: { x: 2 } }, NOW);
  assert.equal(r.notified, false);
  assert.equal(store.rows.length, 0);
});

test("social drafts never send an email by default", () => {
  const social = { kind: "social_drafts_ready" as const, payload: { open: "social" } };
  const state = { prefs: defaultPrefs(), unsubscribedAll: false };
  assert.equal(emailDecision(social, state, NOW), "skip");
});

test("rotation: projects never finished come first, then the oldest marker; duplicates dropped", () => {
  const order = rotationOrder(
    [
      { projectId: "b", userId: "u" },
      { projectId: "a", userId: "u" },
      { projectId: "c", userId: "u" },
      { projectId: "b", userId: "u" },
    ],
    new Map([["b", "2026-10-13T10:00:00Z"], ["c", "2026-10-12T10:00:00Z"]]),
  );
  assert.deepEqual(order.map((t) => t.projectId), ["a", "c", "b"]);
});

test("the three networks are the only ones that draft", () => {
  assert.deepEqual([...SOCIAL_PLATFORMS], ["x", "linkedin", "reddit"]);
});

test("prompts: the daily job's product info is added, clipped, and the route prompts stay unchanged", () => {
  const project = { name: "Acme", description: "Tools", category: "SaaS" };
  const plain = linkedInPrompt(project, 1);
  assert.equal(plain.prompt, "Write 1 LinkedIn post about: Acme\n\nDescription: Tools\n\nCategory: SaaS");
  assert.equal(plain.prompt.includes("Product information"), false);

  const long = "p".repeat(5000);
  const withInfo = redditPrompt(project, "startups", 1, { productInfo: long });
  assert.ok(withInfo.prompt.includes("Product information:\n"));
  assert.ok(withInfo.prompt.includes("p".repeat(4000) + "..."));
  assert.equal(withInfo.prompt.includes("p".repeat(4001)), false);
  assert.ok(withInfo.system.includes("r/startups"));
});
