import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKLOG_LIMIT, DAILY_CALL, DAILY_JOB_CREATE_CAP, GENERATION_FAILED, NOTIFY_RESERVE_MS, RECORD_FAILED, SOCIAL_PLATFORMS, SKIP_REASONS,
  UNEXPECTED, notifySocialDrafts, notifySocialPaused, runDailyDrafts, rotationOrder, skipReasonFor, socialDraftsNotice, socialDraftsPausedNotice,
  socialPhaseBudgetMs, validSubreddit,
  type DailyDraftPorts, type DailyDraftSnapshot,
} from "../lib/domain/social/dailyDrafts.ts";
import type { PlatformId } from "../lib/domain/social/platforms.ts";
import { MemoryNotificationStore } from "../lib/domain/notifications/fakes.ts";
import { defaultPrefs, displayedFrequency, emailDecision } from "../lib/domain/notifications/preferences.ts";
import { socialDraftsTitle, SOCIAL_PAUSED_TITLE } from "../lib/domain/notifications/render.ts";
import { NOTIFICATION_CATEGORIES, categoryOf } from "../lib/domain/notifications/types.ts";
import { linkedInPrompt, redditPrompt } from "../lib/domain/social/platformPrompts.ts";

const NOW = new Date("2026-10-14T09:00:00Z");
const READY: DailyDraftSnapshot = {
  hasProductInfo: true,
  subreddit: "startups",
  modelAccess: "byok",
  creditsAffordable: true,
  enabled: { x: true, linkedin: true, reddit: true },
};

type Outcome = number | "throw";

/**
 * In-memory ports. `result` is the status generate() returns per network (default 201).
 * `attempted` seeds attempt markers as "day:platform". `markDoneFails` makes that many
 * markDone calls throw (Infinity: always).
 */
function fakePorts(opts: {
  snap?: Partial<DailyDraftSnapshot>;
  pending?: Partial<Record<PlatformId, number>>;
  result?: Partial<Record<PlatformId, Outcome>>;
  claim?: boolean;
  attempted?: string[];
  markDoneFails?: number;
} = {}) {
  const calls: PlatformId[] = [];
  const attempted = new Set(opts.attempted ?? []);
  const done = new Map<string, number>();
  let released = 0;
  let markDoneFailures = opts.markDoneFails ?? 0;
  const ports: DailyDraftPorts = {
    claimDay: async () => opts.claim ?? true,
    releaseDay: async () => {
      released += 1;
    },
    isAttempted: async (platform, day) => attempted.has(`${day}:${platform}`),
    markAttempt: async (platform, day) => {
      attempted.add(`${day}:${platform}`);
    },
    markDone: async (platform, day, created) => {
      if (markDoneFailures > 0) {
        markDoneFailures -= 1;
        throw new Error("db down: internals");
      }
      done.set(`${day}:${platform}`, created);
    },
    snapshot: async () => ({ ...READY, ...opts.snap, enabled: { ...READY.enabled, ...opts.snap?.enabled } }),
    pendingCount: async (platform) => opts.pending?.[platform] ?? 0,
    generate: async (platform) => {
      calls.push(platform);
      const outcome = opts.result?.[platform] ?? 201;
      if (outcome === "throw") throw new Error("boom: secret-ish internals");
      if (outcome === 201) return { status: 201, body: { drafts: [{ id: `${platform}-1` }] } };
      return { status: outcome, body: { error: "x" } };
    },
  };
  return { ports, calls, attempted, done, released: () => released };
}

test("one draft per network: all three run, each is attempted and saved", async () => {
  const f = fakePorts();
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(f.calls, ["x", "linkedin", "reddit"]);
  assert.deepEqual(s.created, { x: 1, linkedin: 1, reddit: 1 });
  assert.equal(f.attempted.size, 3);
  assert.equal(f.done.size, 3);
  assert.deepEqual(s.errors, []);
  assert.equal(f.released(), 1);
});

test("reddit needs a saved subreddit; the other networks still run", async () => {
  const f = fakePorts({ snap: { subreddit: null } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(f.calls, ["x", "linkedin"]);
  assert.deepEqual(s.skipped, [{ platform: "reddit", reason: "no_subreddit" }]);
  assert.ok(f.attempted.has("2026-10-14:reddit"), "a legitimate skip is an attempt for the day");
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

test("a 402 from generate is a legitimate skip", async () => {
  const f = fakePorts({ result: { x: 402 } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.ok(s.skipped.some((x) => x.platform === "x" && x.reason === "out_of_credits"));
  assert.ok(f.attempted.has("2026-10-14:x"));
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

test("daily limit: a refused slot (429) is a legitimate skip", async () => {
  const f = fakePorts({ result: { reddit: 429 } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.ok(s.skipped.some((x) => x.platform === "reddit" && x.reason === "daily_limit"));
  assert.ok(f.attempted.has("2026-10-14:reddit"));
});

test("idempotent rerun: a second run the same day generates nothing", async () => {
  const first = fakePorts();
  await runDailyDrafts(first.ports, NOW);
  const second = fakePorts({ attempted: [...first.attempted] });
  const s = await runDailyDrafts(second.ports, NOW);
  assert.deepEqual(second.calls, []);
  assert.equal(s.skipped.filter((x) => x.reason === "already_done").length, 3);
});

test("a new UTC day runs again", async () => {
  const f = fakePorts({ attempted: ["2026-10-14:x", "2026-10-14:linkedin", "2026-10-14:reddit"] });
  await runDailyDrafts(f.ports, new Date("2026-10-15T00:30:00Z"));
  assert.deepEqual(f.calls, ["x", "linkedin", "reddit"]);
});

test("a transient error (502) is reported, counts as the day's attempt, and is not retried the same day", async () => {
  const f = fakePorts({ result: { x: 502 } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(s.errors, [{ platform: "x", error: GENERATION_FAILED }]);
  assert.ok(f.attempted.has("2026-10-14:x"));

  const sameDay = fakePorts({ attempted: [...f.attempted] });
  await runDailyDrafts(sameDay.ports, NOW);
  assert.equal(sameDay.calls.includes("x"), false);

  const nextDay = fakePorts({ attempted: [...f.attempted] });
  await runDailyDrafts(nextDay.ports, new Date("2026-10-15T09:00:00Z"));
  assert.ok(nextDay.calls.includes("x"));
});

test("a project whose networks always fail still rotates: every failed network is attempted", async () => {
  const f = fakePorts({ result: { x: 502, linkedin: 502, reddit: 502 } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.equal(s.errors.length, 3);
  assert.deepEqual([...f.attempted].sort(), ["2026-10-14:linkedin", "2026-10-14:reddit", "2026-10-14:x"]);
});

test("a snapshot failure still counts as the day's attempt for every network, and the error propagates to the job", async () => {
  const f = fakePorts();
  f.ports.snapshot = async () => {
    throw new Error("db down");
  };
  await assert.rejects(runDailyDrafts(f.ports, NOW), /db down/);
  assert.equal(f.attempted.size, 3);
  assert.deepEqual(f.calls, []);
  assert.equal(f.released(), 1);
});

test("a pending-count failure is that network's error; its attempt is still recorded", async () => {
  const f = fakePorts();
  f.ports.pendingCount = async (platform) => {
    if (platform === "linkedin") throw new Error("query failed");
    return 0;
  };
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(f.calls, ["x", "reddit"]);
  assert.deepEqual(s.errors, [{ platform: "linkedin", error: UNEXPECTED }]);
  assert.ok(f.attempted.has("2026-10-14:linkedin"));
});

test("an unexpected throw is a fixed message, never the raw error; other networks still finish", async () => {
  const f = fakePorts({ result: { linkedin: "throw" } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(s.errors, [{ platform: "linkedin", error: UNEXPECTED }]);
  assert.equal(JSON.stringify(s).includes("secret-ish"), false);
  assert.ok(f.done.has("2026-10-14:x"), "other networks still finish");
});

test("a failed markDone is retried twice, then reported once and never regenerated", async () => {
  const recovers = fakePorts({ markDoneFails: 2 });
  const ok = await runDailyDrafts(recovers.ports, NOW);
  assert.deepEqual(ok.errors, []);
  assert.equal(recovers.done.get("2026-10-14:x"), 1);

  const gives = fakePorts({ markDoneFails: Infinity });
  const s = await runDailyDrafts(gives.ports, NOW);
  assert.deepEqual(gives.calls, ["x", "linkedin", "reddit"], "each network is generated once in the run");
  assert.equal(s.created.x, 1, "the saved draft still counts");
  assert.ok(s.errors.some((e) => e.platform === "x" && e.error === RECORD_FAILED));
  assert.equal(JSON.stringify(s).includes("db down"), false);
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

test("the per-network switch off: no model call, marked as an attempt, reported as disabled", async () => {
  const f = fakePorts({ snap: { enabled: { x: true, linkedin: true, reddit: false } } });
  const s = await runDailyDrafts(f.ports, NOW);
  assert.deepEqual(f.calls, ["x", "linkedin"]);
  assert.ok(s.skipped.some((x) => x.platform === "reddit" && x.reason === "disabled"));
  assert.ok(f.attempted.has("2026-10-14:reddit"));
});

test("the global daily ceiling: at the cap nothing is generated and it is reported as daily_cap", async () => {
  const f = fakePorts();
  const s = await runDailyDrafts(f.ports, NOW, { canCreate: () => false });
  assert.deepEqual(f.calls, []);
  assert.equal(s.skipped.filter((x) => x.reason === "daily_cap").length, 3);
});

test("onCreated reports each saved draft count, so the caller can track the ceiling", async () => {
  const f = fakePorts();
  const seen: number[] = [];
  await runDailyDrafts(f.ports, NOW, { onCreated: (n) => seen.push(n) });
  assert.deepEqual(seen, [1, 1, 1]);
});

test("the daily ceiling is 60 job drafts per UTC day", () => {
  assert.equal(DAILY_JOB_CREATE_CAP, 60);
});

test("the background model call has a 20s timeout and no SDK retries", () => {
  assert.deepEqual({ ...DAILY_CALL }, { timeoutMs: 20_000, maxRetries: 0 });
});

test("subreddit: the same rule as the Reddit routes; an invalid saved name is treated as none", () => {
  assert.equal(validSubreddit("startups"), "startups");
  assert.equal(validSubreddit("r/startups"), "startups");
  assert.equal(validSubreddit("a"), null, "one character is too short");
  assert.equal(validSubreddit("a".repeat(22)), null, "22 characters is too long");
  assert.equal(validSubreddit("bad-name"), null, "hyphens are not allowed");
  assert.equal(validSubreddit("a".repeat(21)), "a".repeat(21));
  assert.equal(validSubreddit(""), null);
  assert.equal(validSubreddit(null), null);
});

test("an invalid subreddit makes reddit skip with no_subreddit", () => {
  assert.equal(skipReasonFor("reddit", { ...READY, subreddit: validSubreddit("bad-name") }), "no_subreddit");
});

test("the cron budget keeps 12s for notifications and never exceeds 15s for drafts", () => {
  assert.equal(NOTIFY_RESERVE_MS, 12_000);
  assert.equal(socialPhaseBudgetMs(0, 57_000, 15_000), 15_000);
  assert.equal(socialPhaseBudgetMs(30_000, 57_000, 15_000), 15_000, "still the full 15s while the reserve fits");
  assert.equal(socialPhaseBudgetMs(35_000, 57_000, 15_000), 10_000);
  assert.equal(socialPhaseBudgetMs(40_000, 57_000, 15_000), 5_000, "the drafts stop 12s before the notification deadline");
  assert.equal(socialPhaseBudgetMs(50_000, 57_000, 15_000), 0);
  assert.equal(socialPhaseBudgetMs(70_000, 57_000, 15_000), 0, "never negative");
  // Whatever is left after the drafts phase is always at least the reserve.
  for (const elapsed of [0, 10_000, 33_000, 44_999, 45_000, 52_000]) {
    const drafts = socialPhaseBudgetMs(elapsed, 57_000, 15_000);
    assert.ok(57_000 - (elapsed + drafts) >= Math.min(NOTIFY_RESERVE_MS, 57_000 - elapsed));
  }
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

test("paused notice: one per user per day, in-app, with the fixed title", async () => {
  const draft = socialDraftsPausedNotice({ userId: "u1", day: "2026-10-14" });
  assert.equal(draft.kind, "social_drafts_paused");
  assert.equal(draft.dedupeKey, "social_drafts_paused:u1:2026-10-14");
  assert.equal(draft.title, "Daily social drafts paused: out of credits");
  assert.equal(SOCIAL_PAUSED_TITLE, draft.title);

  const store = new MemoryNotificationStore();
  const first = await notifySocialPaused(store, "u1", "2026-10-14", NOW);
  const second = await notifySocialPaused(store, "u1", "2026-10-14", NOW);
  assert.equal(first.notified, true);
  assert.equal(second.notified, false);
  assert.equal(store.rows.length, 1);
});

test("paused notice respects the content category being off", async () => {
  const store = new MemoryNotificationStore();
  const prefs = defaultPrefs();
  prefs.categories.content = "off";
  await store.savePreferences("u1", prefs);
  const r = await notifySocialPaused(store, "u1", "2026-10-14", NOW);
  assert.equal(r.notified, false);
  assert.equal(store.rows.length, 0);
});

test("social drafts never send an email by default", () => {
  const social = { kind: "social_drafts_ready" as const, payload: { open: "social" } };
  const state = { prefs: defaultPrefs(), unsubscribedAll: false };
  assert.equal(emailDecision(social, state, NOW), "skip");
});

test("content (social drafts) never emails, even when the frequency is instant", () => {
  const prefs = defaultPrefs();
  prefs.categories.content = "instant";
  const state = { prefs, unsubscribedAll: false };
  assert.equal(emailDecision({ kind: "social_drafts_ready", payload: {} }, state, NOW), "skip");
  assert.equal(emailDecision({ kind: "social_drafts_paused", payload: {} }, state, NOW), "skip");
});

test("settings: content is a row in the notification settings and shows in-app only or off", () => {
  assert.ok((NOTIFICATION_CATEGORIES as readonly string[]).includes("content"));
  assert.equal(categoryOf("social_drafts_paused"), "content");
  assert.equal(displayedFrequency("content", "instant"), "daily");
  assert.equal(displayedFrequency("content", "daily"), "daily");
  assert.equal(displayedFrequency("content", "off"), "off");
  assert.equal(displayedFrequency("digest", "weekly"), "weekly");
  assert.equal(displayedFrequency("outcomes", "weekly"), "daily");
});

test("rotation: projects never attempted come first, then the oldest last attempt; duplicates dropped", () => {
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

test("the three networks are the only ones that draft, and the skip reasons are listed", () => {
  assert.deepEqual([...SOCIAL_PLATFORMS], ["x", "linkedin", "reddit"]);
  assert.ok((SKIP_REASONS as readonly string[]).includes("disabled"));
  assert.ok((SKIP_REASONS as readonly string[]).includes("daily_cap"));
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
