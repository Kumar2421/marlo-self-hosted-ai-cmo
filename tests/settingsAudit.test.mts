import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { FakeEmailSender, MemoryNotificationStore } from "../lib/domain/notifications/fakes.ts";
import { runNotificationJob, type UserFacts } from "../lib/domain/notifications/job.ts";
import { defaultPrefs } from "../lib/domain/notifications/preferences.ts";
import { emailReady, notificationConfig } from "../lib/domain/notifications/runtime.ts";

const read = (f: string) => readFileSync(f, "utf8");

// ───────── settings UI: nothing unbuilt is offered ─────────

test("integrations page offers only built connections", () => {
  const src = read("app/settings/integrations/page.tsx");
  for (const gone of ["ComingSoonCard", "XConnectCard", "mock-integrations", "Unlock"]) assert.equal(src.includes(gone), false, gone);
  for (const real of ["WordPressCard", "WebflowCard", "GitHubCodeFixCard", "GmailCard", "GoogleAnalyticsCard"]) assert.ok(src.includes(real), real);
  for (const f of ["components/settings/ComingSoonCard.tsx", "components/settings/XConnectCard.tsx", "lib/mock-integrations.ts"]) assert.equal(existsSync(f), false, f);
});

test("placeholder pages redirect to Websites and are not in the nav", () => {
  for (const r of ["team", "devices", "skills-mcp"]) {
    const src = read(`app/settings/${r}/page.tsx`);
    assert.ok(src.includes('redirect("/settings/websites")'), r);
    assert.equal(src.includes("Invite"), false);
  }
  const nav = read("components/settings/SettingsNav.tsx");
  for (const gone of ["/settings/team", "Personalization", "/settings/devices", "/settings/skills-mcp"]) assert.equal(nav.includes(gone), false, gone);
  assert.ok(nav.includes('label: "Profile"'));
});

test("account page has no disabled coming-soon control", () => {
  const src = read("app/settings/account/page.tsx");
  assert.equal(/coming soon/i.test(src), false);
  assert.ok(src.includes("Update password"));
});

test("notifications page has no quiet-hours control", () => {
  const src = read("app/settings/notifications/page.tsx");
  assert.equal(/quiet/i.test(src), false);
  assert.equal(src.includes("right away"), false);
});

// ───────── notifications: preference -> effect ─────────

const LINKS = { openUrl: "https://app.test/dashboard", unsubscribeUrl: "https://app.test/u?token=x", preferencesUrl: "https://app.test/settings/notifications" };
const MONDAY = new Date("2026-10-05T03:00:00Z"); // the hosted cron time
const facts = (): UserFacts => ({
  email: "u@example.com",
  projects: [],
  credits: { balance: 0, granted: 100, billingEnabled: true },
  integrations: [{ id: "google", label: "Google", disconnected: true }],
});

async function run(prefsPatch: (p: ReturnType<typeof defaultPrefs>) => void, over: { unsub?: boolean; sender?: FakeEmailSender | null } = {}) {
  const store = new MemoryNotificationStore();
  const prefs = defaultPrefs();
  prefsPatch(prefs);
  await store.savePreferences("u1", prefs);
  if (over.unsub) await store.setUnsubscribedAll("u1", true);
  const sender = over.sender === undefined ? new FakeEmailSender() : over.sender;
  const summary = await runNotificationJob({
    source: { listUsers: async () => [{ userId: "u1" }], loadFacts: async () => facts() },
    store, sender, linksFor: () => LINKS, now: MONDAY, budgetMs: 10_000, clock: () => 0,
  });
  return { store, sender, summary };
}

test("default prefs: credits and connection warnings are emailed once, in the app too", async () => {
  const { store, sender } = await run(() => {});
  assert.deepEqual(store.rows.map((r) => r.kind).sort(), ["credits_low", "integration_disconnected"]);
  assert.equal(sender!.sent.length, 2);
});

test("category 'daily' keeps a notification in the app only; 'off' drops it entirely", async () => {
  const { store, sender } = await run((p) => { p.categories.credits = "daily"; p.categories.integrations = "off"; });
  assert.deepEqual(store.rows.map((r) => r.kind), ["credits_low"]);
  assert.equal(sender!.sent.length, 0);
});

test("pause and unsubscribe stop all email but keep in-app items", async () => {
  for (const r of [await run((p) => { p.paused = true; }), await run(() => {}, { unsub: true })]) {
    assert.equal(r.sender!.sent.length, 0);
    assert.equal(r.store.rows.length, 2);
  }
});

test("no email provider: items stay in the app, nothing is sent, no failure", async () => {
  const { store, summary } = await run(() => {}, { sender: null });
  assert.equal(store.rows.length, 2);
  assert.equal(summary.emailed, 0);
  assert.equal(summary.failed.length, 0);
});

test("a stored quiet-hours window (old setting) cannot hold mail back at the 03:00 UTC run", async () => {
  const store = new MemoryNotificationStore();
  await store.savePreferences("u1", { ...defaultPrefs(), timezone: "UTC", quietHours: { startHour: 22, endHour: 7 } } as never);
  const sender = new FakeEmailSender();
  await runNotificationJob({
    source: { listUsers: async () => [{ userId: "u1" }], loadFacts: async () => facts() },
    store, sender, linksFor: () => LINKS, now: MONDAY, budgetMs: 10_000, clock: () => 0,
  });
  assert.equal(sender.sent.length, 2);
});

test("digest 'off' creates no summary; send failures never throw", async () => {
  const sender = new FakeEmailSender();
  sender.results = [{ ok: false, error: "boom", retryable: true }, { ok: false, error: "boom", retryable: true }];
  const { store, summary } = await run((p) => { p.categories.digest = "off"; }, { sender });
  assert.equal(store.rows.some((r) => r.kind === "weekly_digest"), false);
  assert.equal(summary.emailFailed, 2);
  assert.equal(summary.failed.length, 0);
});

test("email is reported ready only with provider key, sender, signing secret and app URL", () => {
  const all = { RESEND_API_KEY: "k", NOTIFY_FROM_EMAIL: "a@b.test", NOTIFY_SIGNING_SECRET: "s".repeat(24), NEXT_PUBLIC_APP_URL: "https://app.test" };
  assert.equal(emailReady(notificationConfig(all)), true);
  for (const missing of Object.keys(all)) {
    const env: Record<string, string> = { ...all };
    delete env[missing];
    assert.equal(emailReady(notificationConfig(env)), false, missing);
  }
});
