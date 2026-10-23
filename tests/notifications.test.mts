import test from "node:test";
import assert from "node:assert/strict";
import { buildDigest, type ProjectActivity, type SnapshotLike } from "../lib/domain/notifications/digest.ts";
import { approvalsKey, creditsKey, creditsThreshold, digestKey, dropDuplicates, integrationKey, isBigWin, withinEmailCap } from "../lib/domain/notifications/caps.ts";
import { DEFAULT_PREFS, defaultPrefs, emailDecision, normalizePrefs } from "../lib/domain/notifications/preferences.ts";
import { signToken, verifyToken } from "../lib/domain/notifications/tokens.ts";
import { renderDigestEmail, renderNotificationEmail } from "../lib/domain/notifications/render.ts";
import { resendSender } from "../lib/domain/notifications/resendSender.ts";
import { FakeEmailSender, MemoryNotificationStore } from "../lib/domain/notifications/fakes.ts";
import { runNotificationJob, type NotificationSource, type UserFacts } from "../lib/domain/notifications/job.ts";

const SECRET = "test-secret-0123456789";
const LINKS = { openUrl: "https://app.test/dashboard", unsubscribeUrl: "https://app.test/api/notifications/unsubscribe?token=abc", preferencesUrl: "https://app.test/settings/notifications" };
const DAY = 86_400_000;
// 2026-10-05 is a Monday.
const MONDAY = new Date("2026-10-05T06:00:00Z");

const snap = (date: string, clicks: number, impressions: number, position = 5): SnapshotLike => ({
  snapshotDate: date, payload: { windows: { d7: { queries: [{ clicks, impressions, position }] } } },
});

function idleProject(over: Partial<ProjectActivity> = {}): ProjectActivity {
  return { projectId: "p1", projectName: "Site", newOutcomes: [], fixesMade: [], latest: null, weekAgo: null, approvalsWaiting: 0, ...over };
}

// ───────── digest ─────────

test("digest is null when nothing happened", () => {
  assert.equal(buildDigest([]), null);
  assert.equal(buildDigest([idleProject()]), null);
  // Same numbers both weeks: not news.
  assert.equal(buildDigest([idleProject({ latest: snap("2026-10-05", 40, 1000), weekAgo: snap("2026-09-28", 40, 1000) })]), null);
  // Tiny wobble below the thresholds: not news.
  assert.equal(buildDigest([idleProject({ latest: snap("2026-10-05", 42, 1030), weekAgo: snap("2026-09-28", 40, 1000) })]), null);
});

test("digest includes measured fixes, changes, movement and approvals", () => {
  const digest = buildDigest([
    idleProject({
      newOutcomes: [{ actionTitle: "Rewrite title", status: "improved", confidence: "solid", headline: "Improved: click rate 2.0% → 3.1% after 14 days." }],
      fixesMade: [{ title: "Add canonical" }],
      latest: snap("2026-10-05", 80, 2000, 4), weekAgo: snap("2026-09-28", 40, 1000, 6),
      approvalsWaiting: 2,
    }),
  ]);
  assert.ok(digest);
  const p = digest.projects[0];
  assert.equal(p.movement?.clicks.after, 80);
  assert.equal(p.approvalsWaiting, 2);
  assert.match(digest.summary, /1 fix measured/);
  const email = renderDigestEmail(digest, LINKS);
  assert.match(email.text, /Improved: click rate/);
  assert.match(email.text, /not proof the fix caused it/);
  assert.match(email.subject, /^Your Marlo week:/);
});

test("movement needs two different snapshots", () => {
  const same = buildDigest([idleProject({ latest: snap("2026-10-05", 80, 2000), weekAgo: snap("2026-10-05", 10, 100) })]);
  assert.equal(same, null);
});

// ───────── caps ─────────

test("dedupe keys group by week, month, 3-day window and day", () => {
  assert.equal(digestKey("2026-10-05"), digestKey("2026-10-11"));
  assert.notEqual(digestKey("2026-10-05"), digestKey("2026-10-12"));
  assert.equal(creditsKey(20, new Date("2026-10-01T00:00:00Z")), creditsKey(20, new Date("2026-10-30T00:00:00Z")));
  assert.notEqual(creditsKey(20, new Date("2026-10-01T00:00:00Z")), creditsKey(0, new Date("2026-10-01T00:00:00Z")));
  assert.notEqual(creditsKey(20, new Date("2026-10-01T00:00:00Z")), creditsKey(20, new Date("2026-11-01T00:00:00Z")));
  const t = Date.UTC(2026, 9, 5, 12);
  assert.equal(integrationKey("gsc", new Date(t)), integrationKey("gsc", new Date(t + DAY)));
  assert.notEqual(integrationKey("gsc", new Date(t)), integrationKey("gsc", new Date(t + 3 * DAY)));
  assert.notEqual(integrationKey("gsc", new Date(t)), integrationKey("gmail", new Date(t)));
  assert.notEqual(approvalsKey("2026-10-05"), approvalsKey("2026-10-06"));
});

test("email caps, credits thresholds, big wins and batch dedupe", () => {
  assert.equal(withinEmailCap("outcome_measured", 0), true);
  assert.equal(withinEmailCap("outcome_measured", 1), false);
  assert.equal(withinEmailCap("credits_low", 5), true);
  assert.equal(creditsThreshold(0, 20), 0);
  assert.equal(creditsThreshold(4, 20), 20);
  assert.equal(creditsThreshold(5, 20), null);
  assert.equal(isBigWin({ status: "improved", confidence: "solid" }), true);
  assert.equal(isBigWin({ status: "improved", confidence: "early" }), false);
  assert.equal(isBigWin({ status: "regressed", confidence: "solid" }), false);
  const kept = dropDuplicates([{ dedupeKey: "a" }, { dedupeKey: "a" }, { dedupeKey: "b" }, { dedupeKey: "c" }], new Set(["c"]));
  assert.deepEqual(kept.map((d) => d.dedupeKey), ["a", "b"]);
});

// ───────── preferences ─────────

test("preferences default on, tolerate junk, and pause stops email", () => {
  const d = defaultPrefs();
  for (const frequency of Object.values(d.categories)) assert.notEqual(frequency, "off");
  assert.equal(d.paused, false);

  const junk = normalizePrefs({ categories: { digest: "hourly", credits: "off" }, paused: "yes", timezone: "Not/AZone" });
  assert.equal(junk.categories.digest, DEFAULT_PREFS.categories.digest);
  assert.equal(junk.categories.credits, "off");
  assert.equal(junk.paused, false);
  assert.equal(junk.timezone, null);
  assert.deepEqual(normalizePrefs(null), defaultPrefs());

  const credits = { kind: "credits_low" as const, payload: {} };
  assert.equal(emailDecision(credits, { prefs: d, unsubscribedAll: false } ), "send");
  assert.equal(emailDecision(credits, { prefs: { ...d, paused: true }, unsubscribedAll: false } ), "skip");
  assert.equal(emailDecision(credits, { prefs: d, unsubscribedAll: true } ), "skip");
  assert.equal(emailDecision(credits, { prefs: { ...d, categories: { ...d.categories, credits: "off" } }, unsubscribedAll: false } ), "skip");
  // Approvals default to daily: in-app and digest only.
  assert.equal(emailDecision({ kind: "approval_needed", payload: {} }, { prefs: d, unsubscribedAll: false } ), "skip");
  // Only a big win interrupts.
  assert.equal(emailDecision({ kind: "outcome_measured", payload: { bigWin: false } }, { prefs: d, unsubscribedAll: false } ), "skip");
  assert.equal(emailDecision({ kind: "outcome_measured", payload: { bigWin: true } }, { prefs: d, unsubscribedAll: false } ), "send");
});

test("quiet hours no longer exist: stored values are ignored and never delay an email", () => {
  const prefs = normalizePrefs({ timezone: "America/New_York", quietHours: { startHour: 22, endHour: 7 } });
  assert.equal("quietHours" in prefs, false);
  // 06:00 UTC would have been inside the old 22:00-07:00 window; the email still goes out.
  assert.equal(emailDecision({ kind: "credits_low", payload: {} }, { prefs, unsubscribedAll: false }), "send");
});

// ───────── tokens ─────────

test("tokens verify, and fail closed", () => {
  const now = new Date("2026-10-05T00:00:00Z");
  const token = signToken({ userId: "u1", scope: "unsubscribe", now }, SECRET)!;
  assert.deepEqual(verifyToken(token, "unsubscribe", SECRET, now), { userId: "u1" });
  // Wrong secret, tampering, garbage, expiry, no secret.
  assert.equal(verifyToken(token, "unsubscribe", "another-secret-0123456789", now), null);
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "u2", s: "unsubscribe", e: 9_999_999_999 })).toString("base64url");
  assert.equal(verifyToken(`${forged}.${sig}`, "unsubscribe", SECRET, now), null);
  assert.equal(verifyToken(`${body}.`, "unsubscribe", SECRET, now), null);
  assert.equal(verifyToken("garbage", "unsubscribe", SECRET, now), null);
  assert.equal(verifyToken(null, "unsubscribe", SECRET, now), null);
  assert.equal(verifyToken(token, "unsubscribe", SECRET, new Date(now.getTime() + 400 * DAY)), null);
  assert.equal(signToken({ userId: "u1", scope: "unsubscribe" }, undefined), null);
  assert.equal(signToken({ userId: "u1", scope: "unsubscribe" }, "short"), null);
  assert.equal(verifyToken(token, "unsubscribe", undefined, now), null);
  assert.equal(verifyToken(token, "unsubscribe", "", now), null);
});

// ───────── render ─────────

test("rendered email has unsubscribe links, headers, escaped content and no images", () => {
  const email = renderNotificationEmail({ kind: "credits_low", title: "Low <b>credits</b>", body: "5 left & counting" }, LINKS);
  assert.equal(email.headers["List-Unsubscribe"], `<${LINKS.unsubscribeUrl}>`);
  assert.equal(email.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(email.html.includes(LINKS.unsubscribeUrl));
  assert.ok(email.html.includes(LINKS.preferencesUrl));
  assert.ok(email.text.includes(LINKS.unsubscribeUrl));
  assert.ok(!email.html.includes("<img"));
  assert.ok(!email.html.includes("<b>credits"));
  assert.match(email.html, /&amp; counting/);
  assert.match(email.html, /<html lang="en">/);
});

// ───────── resend adapter ─────────

test("resend adapter sends the documented request and classifies failures", async () => {
  const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> = [];
  const make = (status: number, body: unknown) =>
    resendSender({
      apiKey: "re_secret_key", from: "Marlo <notify@example.com>",
      fetch: async (url, init) => { calls.push({ url, init }); return { ok: status < 300, status, json: async () => body }; },
    });
  const message = { to: "a@b.co", subject: "S", html: "<p>h</p>", text: "t", headers: { "List-Unsubscribe": "<https://x>" }, idempotencyKey: "k1" };

  assert.deepEqual(await make(200, { id: "em_1" }).send(message), { ok: true, id: "em_1" });
  const call = calls[0];
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization, "Bearer re_secret_key");
  assert.equal(call.init.headers["Idempotency-Key"], "k1");
  const sent = JSON.parse(call.init.body);
  assert.deepEqual(sent.to, ["a@b.co"]);
  assert.equal(sent.from, "Marlo <notify@example.com>");
  assert.deepEqual(sent.headers, { "List-Unsubscribe": "<https://x>" });

  const rejected = await make(422, { message: "Invalid `to` field" }).send(message);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok === false && rejected.retryable, false);
  const limited = await make(429, { message: "slow down" }).send(message);
  assert.equal(limited.ok === false && limited.retryable, true);
  assert.equal(JSON.stringify(rejected).includes("re_secret_key"), false);

  const down = await resendSender({ apiKey: "re_secret_key", from: "x", fetch: async () => { throw new Error("boom re_secret_key"); } }).send(message);
  assert.equal(down.ok === false && down.retryable, true);
  assert.equal(JSON.stringify(down).includes("re_secret_key"), false);
});

// ───────── job ─────────

function factsWith(over: Partial<UserFacts> = {}): UserFacts {
  return {
    email: "u@example.com",
    projects: [{
      projectId: "p1", projectName: "Site",
      measured: [{ actionId: "a1", actionTitle: "Rewrite title", status: "improved", confidence: "solid", headline: "Improved: position 9.0 → 6.0 after 15 days.", evaluatedAt: new Date(MONDAY.getTime() - 1 * DAY).toISOString() }],
      fixesMade: [{ title: "Rewrite title", implementedAt: new Date(MONDAY.getTime() - 16 * DAY).toISOString() }],
      latest: snap("2026-10-05", 80, 2000), weekAgo: snap("2026-09-28", 40, 1000), approvalsWaiting: 1,
    }],
    credits: { balance: 3, granted: 20, billingEnabled: true },
    integrations: [{ id: "gsc", label: "Search Console", disconnected: true }],
    ...over,
  };
}

function deps(facts: UserFacts, store = new MemoryNotificationStore(), sender: FakeEmailSender | null = new FakeEmailSender(), now = MONDAY) {
  const source: NotificationSource = { listUsers: async () => [{ userId: "u1" }], loadFacts: async () => facts };
  return { source, store, sender, linksFor: () => LINKS, now, budgetMs: 10_000 };
}

test("job creates each notification once and emails once, even when rerun", async () => {
  const store = new MemoryNotificationStore();
  const sender = new FakeEmailSender();
  const first = await runNotificationJob(deps(factsWith(), store, sender));
  assert.equal(first.failed.length, 0);
  const kinds = store.rows.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ["approval_needed", "credits_low", "integration_disconnected", "outcome_measured", "weekly_digest"]);

  // Emails: big win (instant), credits, integration, digest. Approvals default to daily: in-app only.
  const subjects = sender.sent.map((m) => m.subject);
  assert.equal(sender.sent.length, 4);
  assert.ok(subjects.some((s) => s.startsWith("A fix looks like it worked")));
  assert.ok(subjects.some((s) => s.startsWith("Your Marlo week")));
  assert.ok(sender.sent.every((m) => m.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click"));
  assert.equal(new Set(sender.sent.map((m) => m.idempotencyKey)).size, 4);
  // The instant big win is not repeated in the digest.
  const digestMail = sender.sent.find((m) => m.subject.startsWith("Your Marlo week"))!;
  assert.ok(!digestMail.text.includes("Fixes we measured"));

  const again = await runNotificationJob(deps(factsWith(), store, sender));
  assert.equal(again.created, 0);
  assert.equal(sender.sent.length, 4);
  assert.equal(store.rows.length, 5);
});

test("job sends no digest on an idle Monday or on other weekdays", async () => {
  const idle: UserFacts = { email: "u@example.com", projects: [], credits: null, integrations: [] };
  const sender = new FakeEmailSender();
  const store = new MemoryNotificationStore();
  await runNotificationJob(deps(idle, store, sender));
  assert.equal(store.rows.length, 0);
  assert.equal(sender.sent.length, 0);

  const tuesday = new Date(MONDAY.getTime() + DAY);
  const busy = factsWith({ credits: null, integrations: [] });
  await runNotificationJob(deps(busy, store, sender, MONDAY));
  assert.equal(store.rows.filter((r) => r.kind === "weekly_digest").length, 1);
  await runNotificationJob(deps(busy, store, sender, tuesday));
  assert.equal(store.rows.filter((r) => r.kind === "weekly_digest").length, 1);
});

test("job digest follows the user's timezone Monday", async () => {
  const store = new MemoryNotificationStore();
  await store.savePreferences("u1", normalizePrefs({ timezone: "Pacific/Auckland" }));
  // 2026-10-04 20:00 UTC is already Monday 09:00 in Auckland.
  const sundayUtc = new Date("2026-10-04T20:00:00Z");
  await runNotificationJob(deps(factsWith(), store, new FakeEmailSender(), sundayUtc));
  assert.ok(store.rows.some((r) => r.kind === "weekly_digest"));
});

test("job respects pause, unsubscribe, and missing email or sender", async () => {
  for (const setup of ["paused", "unsub", "noEmail", "noSender"] as const) {
    const store = new MemoryNotificationStore();
    if (setup === "paused") await store.savePreferences("u1", { ...defaultPrefs(), paused: true });
    if (setup === "unsub") await store.setUnsubscribedAll("u1", true);
    const sender = setup === "noSender" ? null : new FakeEmailSender();
    await runNotificationJob(deps(factsWith(setup === "noEmail" ? { email: null } : {}), store, sender));
    assert.ok(store.rows.length > 0, `${setup}: in-app items still appear`);
    if (sender) assert.equal(sender.sent.length, 0, setup);
  }
});

test("job: category off creates nothing; billing off means no credits warning", async () => {
  const store = new MemoryNotificationStore();
  await store.savePreferences("u1", normalizePrefs({ categories: { integrations: "off" } }));
  await runNotificationJob(deps(factsWith({ credits: { balance: 0, granted: 20, billingEnabled: false } }), store));
  assert.ok(!store.rows.some((r) => r.kind === "integration_disconnected"));
  assert.ok(!store.rows.some((r) => r.kind === "credits_low"));
});

test("job: retryable failure is retried, permanent failure is not, one user failing does not stop others", async () => {
  const store = new MemoryNotificationStore();
  const sender = new FakeEmailSender();
  const only = factsWith({ projects: [], integrations: [] });
  sender.results = [{ ok: false, error: "Could not reach Resend.", retryable: true }];
  const d = deps(only, store, sender);
  await runNotificationJob(d);
  assert.equal(store.rows[0].emailedAt, null);
  assert.equal(store.rows[0].emailError, null);
  await runNotificationJob({ ...d, now: new Date(MONDAY.getTime() + 3600_000) });
  assert.ok(store.rows[0].emailedAt);

  const store2 = new MemoryNotificationStore();
  const sender2 = new FakeEmailSender();
  sender2.results = [{ ok: false, error: "Resend responded 422", retryable: false }];
  await runNotificationJob(deps(only, store2, sender2));
  assert.match(store2.rows[0].emailError ?? "", /422/);
  await runNotificationJob(deps(only, store2, sender2));
  assert.equal(sender2.sent.length, 1);

  const source: NotificationSource = {
    listUsers: async () => [{ userId: "bad" }, { userId: "u1" }],
    loadFacts: async (id) => { if (id === "bad") throw new Error("db down"); return only; },
  };
  const store3 = new MemoryNotificationStore();
  const result = await runNotificationJob({ source, store: store3, sender: new FakeEmailSender(), linksFor: () => LINKS, now: MONDAY, budgetMs: 10_000 });
  assert.equal(result.failed.length, 1);
  assert.ok(store3.rows.length > 0);
});

test("job: only one big-win email per day", async () => {
  const store = new MemoryNotificationStore();
  const sender = new FakeEmailSender();
  const win = (id: string) => ({ actionId: id, actionTitle: `Fix ${id}`, status: "improved", confidence: "solid" as const, headline: "Improved.", evaluatedAt: new Date(MONDAY.getTime() - DAY).toISOString() });
  const facts = factsWith({ credits: null, integrations: [] });
  facts.projects[0].measured = [win("a1"), win("a2")];
  facts.projects[0].approvalsWaiting = 0;
  await runNotificationJob(deps(facts, store, sender));
  assert.equal(sender.sent.filter((m) => m.subject.startsWith("A fix looks like it worked")).length, 1);
});

// ───────── SQLite store ─────────

test("sqlite store dedupes per user, tracks read and emailed, and survives bad rows", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { sqliteNotificationStore } = await import("../lib/domain/notifications/notificationStore.ts");
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE notification_preferences (user_id TEXT PRIMARY KEY, prefs TEXT NOT NULL DEFAULT '{}', unsubscribed_all INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, last_run_at TEXT, last_test_email_at TEXT);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, read_at TEXT, emailed_at TEXT, email_error TEXT, email_attempts INTEGER NOT NULL DEFAULT 0, last_email_attempt_at TEXT, UNIQUE (user_id, dedupe_key));`);
  const store = sqliteNotificationStore(db);
  const draft = { kind: "credits_low" as const, projectId: null, dedupeKey: "k", title: "t", body: "b", payload: { x: 1 } };

  assert.equal((await store.record("u1", draft, MONDAY)).created, true);
  assert.equal((await store.record("u1", draft, MONDAY)).created, false);
  assert.equal((await store.record("u2", draft, MONDAY)).created, true);
  assert.equal(await store.unreadCount("u1"), 1);

  const [n] = await store.list("u1");
  assert.deepEqual(n.payload, { x: 1 });
  assert.equal((await store.listEmailPending("u1", new Date(MONDAY.getTime() - DAY).toISOString())).length, 1);
  await store.markRead("u2", [n.id], MONDAY); // someone else's id: no effect on u1
  assert.equal(await store.unreadCount("u1"), 1);
  await store.markRead("u1", [n.id], MONDAY);
  assert.equal(await store.unreadCount("u1"), 0);

  await store.markEmailed("u1", n.id, MONDAY, null);
  assert.equal((await store.listEmailPending("u1", "2000-01-01")).length, 0);
  assert.equal(await store.countEmailedSince("u1", "credits_low", new Date(MONDAY.getTime() - DAY).toISOString()), 1);

  assert.deepEqual((await store.getPreferences("u1")).prefs, defaultPrefs());
  await store.savePreferences("u1", normalizePrefs({ paused: true }));
  await store.setUnsubscribedAll("u1", true);
  const saved = await store.getPreferences("u1");
  assert.equal(saved.prefs.paused, true);
  assert.equal(saved.unsubscribedAll, true);
});

// ───────── facts ─────────

test("facts: solid verdicts, fixes made and fix PRs waiting", async () => {
  const { projectFactsFromActions } = await import("../lib/domain/notifications/facts.ts");
  const done = (id: string, outcome: unknown, saved = false) => ({
    id, projectId: "p", findingId: "f", type: "rewrite_snippet", status: "completed", title: `Fix ${id}`, target: {}, parameters: {},
    result: { implementation: { via: "manual", implementedAt: "2026-09-10T00:00:00Z", baseline: null }, ...(saved ? { outcome: { ...(outcome as object), evaluatedAt: "2026-10-04T00:00:00Z" } } : {}) },
    createdAt: "t", startedAt: null, completedAt: "t", outcome, canUndo: false,
  });
  const solid = { status: "improved", confidence: "solid", headline: "Improved." };
  const early = { status: "improved", confidence: "early", headline: "Early." };
  const waiting = { id: "w", projectId: "p", findingId: "f", type: "manual_fix", status: "proposed", title: "PR", target: {}, parameters: {}, result: { pullRequest: { url: "https://github.com/x/y/pull/1" } }, createdAt: "t", startedAt: null, completedAt: null, outcome: null, canUndo: false };
  const plain = { ...waiting, id: "x", result: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const facts = projectFactsFromActions({ id: "p", name: "Site" }, [done("a", solid, true), done("b", early), done("c", solid), waiting, plain] as any, { latest: null, weekAgo: null }, MONDAY);
  assert.deepEqual(facts.measured.map((m) => m.actionId).sort(), ["a", "c"]);
  assert.equal(facts.measured.find((m) => m.actionId === "a")?.evaluatedAt, "2026-10-04T00:00:00Z");
  assert.equal(facts.measured.find((m) => m.actionId === "c")?.evaluatedAt, MONDAY.toISOString());
  assert.equal(facts.fixesMade.length, 3);
  assert.equal(facts.approvalsWaiting, 1);
});

// ───────── review fixes ─────────

const idleFacts = (): UserFacts => ({ email: null, projects: [], credits: null, integrations: [] });
const win = (id: string) => ({ actionId: id, actionTitle: `Fix ${id}`, status: "improved", confidence: "solid" as const, headline: "Improved.", evaluatedAt: new Date(MONDAY.getTime() - DAY).toISOString() });

test("job: a missed Monday digest fires on the first run after it, once", async () => {
  const store = new MemoryNotificationStore();
  const sender = new FakeEmailSender();
  const facts = factsWith({ credits: null, integrations: [] });
  const wednesday = new Date(MONDAY.getTime() + 2 * DAY);
  await runNotificationJob(deps(facts, store, sender, wednesday));
  assert.equal(store.rows.filter((r) => r.kind === "weekly_digest").length, 1);
  await runNotificationJob(deps(facts, store, sender, new Date(wednesday.getTime() + DAY)));
  assert.equal(store.rows.filter((r) => r.kind === "weekly_digest").length, 1);
});

test("job: a daily digest is titled for the day", async () => {
  const store = new MemoryNotificationStore();
  await store.savePreferences("u1", normalizePrefs({ categories: { digest: "daily" } }));
  const sender = new FakeEmailSender();
  await runNotificationJob(deps(factsWith({ credits: null, integrations: [] }), store, sender));
  const mail = sender.sent.find((m) => /^Your Marlo (day|week)/.test(m.subject))!;
  assert.match(mail.subject, /^Your Marlo day:/);
  assert.match(mail.text, /Your day in Marlo/);
});

test("job: users who waited longest go first; finished users are stamped and skipped today", async () => {
  const store = new MemoryNotificationStore();
  store.runs.set("b", "2026-10-03T00:00:00.000Z");
  store.runs.set("a", "2026-10-04T00:00:00.000Z");
  const order: string[] = [];
  const source: NotificationSource = { listUsers: async () => [{ userId: "a" }, { userId: "b" }, { userId: "c" }], loadFacts: async (id) => { order.push(id); return idleFacts(); } };
  const base = { source, store, sender: null, linksFor: () => LINKS, now: MONDAY, budgetMs: 10_000, oncePerDay: true };
  await runNotificationJob(base);
  assert.deepEqual(order, ["c", "b", "a"]);
  assert.equal(store.runs.get("c"), MONDAY.toISOString());
  order.length = 0;
  const again = await runNotificationJob(base);
  assert.deepEqual(order, []);
  assert.equal(again.users, 0);
});

test("job: a budget that runs out mid-user leaves that user unstamped and the rotation fair", async () => {
  const store = new MemoryNotificationStore();
  let t = 0;
  const source: NotificationSource = {
    listUsers: async () => [{ userId: "a" }, { userId: "b" }],
    loadFacts: async () => { t += 100; return factsWith(); },
  };
  const result = await runNotificationJob({ source, store, sender: null, linksFor: () => LINKS, now: MONDAY, budgetMs: 150, clock: () => t });
  assert.equal(result.interrupted, 1);
  assert.deepEqual([...store.runs.keys()], ["a"]);
  // "a" got done on another run; "b" has waited longest and goes first.
  store.runs.set("a", "2026-10-05T00:00:00.000Z");
  const order: string[] = [];
  source.loadFacts = async (id) => { order.push(id); return idleFacts(); };
  await runNotificationJob({ source, store, sender: null, linksFor: () => LINKS, now: new Date(MONDAY.getTime() + DAY), budgetMs: 10_000 });
  assert.deepEqual(order, ["b", "a"]);
});

test("job: a second big win is reported once, in the digest, never also emailed alone later", async () => {
  const store = new MemoryNotificationStore();
  const sender = new FakeEmailSender();
  const facts = factsWith({ credits: null, integrations: [] });
  facts.projects[0].measured = [win("a1"), win("a2")];
  facts.projects[0].approvalsWaiting = 0;
  await runNotificationJob(deps(facts, store, sender));
  const digest = sender.sent.find((m) => m.subject.startsWith("Your Marlo week"))!;
  assert.ok(digest.text.includes("Fix a2"));
  assert.ok(!digest.text.includes("Fix a1"));
  await runNotificationJob(deps(facts, store, sender, new Date(MONDAY.getTime() + DAY + 3600_000)));
  assert.equal(sender.sent.filter((m) => m.subject.includes("Fix a2")).length, 0);
});

test("job: a big win whose instant email did not go out is still reported in the digest", async () => {
  const store = new MemoryNotificationStore();
  const sender = new FakeEmailSender();
  sender.results = [{ ok: false, error: "Resend responded 500", retryable: true }];
  const facts = factsWith({ credits: null, integrations: [] });
  facts.projects[0].approvalsWaiting = 0;
  await runNotificationJob(deps(facts, store, sender));
  const digest = sender.sent.find((m) => m.subject.startsWith("Your Marlo week"));
  assert.ok(digest && digest.text.includes("Rewrite title"));
});

test("job: config errors (bad key, unverified domain) keep the email pending and never block it", async () => {
  const store = new MemoryNotificationStore();
  const sender = new FakeEmailSender();
  const only = factsWith({ projects: [], integrations: [] });
  sender.results = [{ ok: false, error: "Resend responded 401", retryable: true, configError: true }];
  const logs: string[] = [];
  await runNotificationJob({ ...deps(only, store, sender), log: (m) => logs.push(m) });
  assert.equal(store.rows[0].emailError, null);
  assert.equal(store.rows[0].emailAttempts, 0);
  assert.ok(logs.some((l) => /401/.test(l)));
  await runNotificationJob(deps(only, store, sender, new Date(MONDAY.getTime() + 3600_000)));
  assert.ok(store.rows[0].emailedAt);
});

test("job: a retryable failure waits before retrying and is given up on after the max attempts", async () => {
  const store = new MemoryNotificationStore();
  const sender = new FakeEmailSender();
  const only = factsWith({ projects: [], integrations: [] });
  const fail = { ok: false as const, error: "Could not reach Resend.", retryable: true };
  sender.results = [fail, fail, fail, fail, fail];
  await runNotificationJob(deps(only, store, sender));
  assert.equal(store.rows[0].emailAttempts, 1);
  await runNotificationJob(deps(only, store, sender, new Date(MONDAY.getTime() + 60_000)));
  assert.equal(sender.sent.length, 1);
  for (let i = 1; i <= 3; i += 1) await runNotificationJob(deps(only, store, sender, new Date(MONDAY.getTime() + i * 3600_000)));
  assert.match(store.rows[0].emailError ?? "", /Gave up after 4 attempts/);
  assert.equal(store.rows[0].emailedAt, null);
});

test("resend: 401/403 and unverified-domain 422 are config errors", async () => {
  const message = { to: "a@b.co", subject: "S", html: "h", text: "t", headers: {}, idempotencyKey: "k" };
  const make = (status: number, body: unknown) => resendSender({ apiKey: "k", from: "x", fetch: async () => ({ ok: false, status, json: async () => body }) });
  for (const [status, body] of [[401, { message: "API key is invalid" }], [403, { message: "forbidden" }], [422, { message: "The example.com domain is not verified." }]] as const) {
    const r = await make(status, body).send(message);
    assert.equal(r.ok === false && r.configError, true, String(status));
  }
  const bad = await make(422, { message: "Invalid to field" }).send(message);
  assert.equal(bad.ok === false && bad.configError, false);
});

test("daily digest email is titled for the day", () => {
  const digest = buildDigest([idleProject({ approvalsWaiting: 2 })])!;
  assert.match(renderDigestEmail(digest, LINKS, "daily").subject, /^Your Marlo day:/);
  assert.match(renderDigestEmail(digest, LINKS).subject, /^Your Marlo week:/);
});

test("test-email claims are rate limited per user", async () => {
  const store = new MemoryNotificationStore();
  assert.equal(await store.claimTestSend("u1", MONDAY, 30_000), true);
  assert.equal(await store.claimTestSend("u1", new Date(MONDAY.getTime() + 5_000), 30_000), false);
  assert.equal(await store.claimTestSend("u2", MONDAY, 30_000), true);
  assert.equal(await store.claimTestSend("u1", new Date(MONDAY.getTime() + 31_000), 30_000), true);
});

test("same-origin guard", async () => {
  const { isSameOriginRequest } = await import("../lib/domain/notifications/sameOrigin.ts");
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(isSameOriginRequest(h({ origin: "http://localhost:3000", host: "localhost:3000" })), true);
  assert.equal(isSameOriginRequest(h({ origin: "https://evil.example", host: "localhost:3000" })), false);
  assert.equal(isSameOriginRequest(h({ origin: "null", host: "localhost:3000" })), false);
  assert.equal(isSameOriginRequest(h({ "sec-fetch-site": "same-origin", host: "x" })), true);
  assert.equal(isSameOriginRequest(h({ "sec-fetch-site": "cross-site", host: "x" })), false);
  assert.equal(isSameOriginRequest(h({ host: "x" })), false);
});

test("sqlite store: run stamps, attempts, keys and test-send claims", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { sqliteNotificationStore } = await import("../lib/domain/notifications/notificationStore.ts");
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE notification_preferences (user_id TEXT PRIMARY KEY, prefs TEXT NOT NULL DEFAULT '{}', unsubscribed_all INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, last_run_at TEXT, last_test_email_at TEXT);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, read_at TEXT, emailed_at TEXT, email_error TEXT, email_attempts INTEGER NOT NULL DEFAULT 0, last_email_attempt_at TEXT, UNIQUE (user_id, dedupe_key));`);
  const store = sqliteNotificationStore(db);
  assert.deepEqual([...(await store.lastRuns(["u1"])).entries()], [["u1", null]]);
  await store.stampRun("u1", MONDAY);
  await store.savePreferences("u1", normalizePrefs({ paused: true })); // must not clear the stamp
  assert.equal((await store.lastRuns(["u1"])).get("u1"), MONDAY.toISOString());

  const r = await store.record("u1", { kind: "credits_low", projectId: null, dedupeKey: "k", title: "t", body: "b", payload: {} }, MONDAY);
  assert.equal(await store.hasKey("u1", "k"), true);
  assert.equal(await store.hasKey("u2", "k"), false);
  await store.noteEmailAttempt("u1", r.id!, MONDAY);
  const [n] = await store.list("u1");
  assert.equal(n.emailAttempts, 1);
  assert.equal(n.lastEmailAttemptAt, MONDAY.toISOString());

  assert.equal(await store.claimTestSend("u9", MONDAY, 30_000), true);
  assert.equal(await store.claimTestSend("u9", new Date(MONDAY.getTime() + 1000), 30_000), false);
  assert.equal(await store.claimTestSend("u9", new Date(MONDAY.getTime() + 31_000), 30_000), true);
});
