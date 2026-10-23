import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { OUTREACH_DAILY_CAP } from "../lib/domain/leads/outreachContract.ts";
import { isGuessedLead, planOutreach, utcDayStart, type PlanLead } from "../lib/domain/leads/outreachPlan.ts";
import { memoryOutreachStore, OutreachNotSetUpError } from "../lib/domain/leads/outreachStore.ts";
import { sqliteOutreachStore } from "../lib/domain/leads/outreachStoreSqlite.ts";
import {
  computePlan, handlePlan, handleSend, handleStatus, parseSendRequest,
  type OutreachDeps, type OutreachLeadRow,
} from "../lib/domain/leads/outreachSend.ts";
import { base64Url, buildOutreachMime, encodeHeaderText } from "../lib/domain/leads/outreachMime.ts";
import { isStopRequest, plainTextFromGmailPayload } from "../lib/domain/leads/replyStop.ts";
import { applyUnsubscribe, checkUnsubscribeToken, recordReplyStops } from "../lib/domain/leads/outreachUnsubscribe.ts";
import { signToken, verifyToken } from "../lib/domain/notifications/tokens.ts";

const SECRET = "test-secret-0123456789abcdef";
const USER = "user-1";
const NOW = new Date("2026-10-23T12:00:00.000Z");
const DAY = 24 * 3600 * 1000;

const lead = (n: number, extra: Partial<OutreachLeadRow> = {}): OutreachLeadRow => ({
  id: `l${n}`, email: `p${n}@example.com`, name: `Person ${n}`, company: "Acme", title: "CEO", emailVerified: false, ...extra,
});
const ids = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`);

function setup(opts: { leads?: OutreachLeadRow[]; missing?: boolean; secret?: string | null; appUrl?: string | null; failFor?: string[] } = {}) {
  const store = memoryOutreachStore({ missing: opts.missing });
  const leads = opts.leads ?? Array.from({ length: 40 }, (_, i) => lead(i));
  const raws: string[] = [];
  const marks: Array<{ leadId: string; status: string }> = [];
  const credits: number[] = [];
  let n = 0;
  const deps: OutreachDeps = {
    store, userId: USER, projectId: "proj-1", now: () => NOW,
    async loadLeads(wanted) { return leads.filter((l) => wanted.includes(l.id)); },
    sender: { email: "me@gmail.test", name: "Me" },
    signingSecret: opts.secret === undefined ? SECRET : opts.secret,
    appUrl: opts.appUrl === undefined ? "https://marlo.test" : opts.appUrl,
    async sendRaw(raw) {
      const decoded = Buffer.from(raw, "base64url").toString("utf8");
      const to = /^To: (.+)$/m.exec(decoded)?.[1] ?? "";
      if (opts.failFor?.some((e) => to.includes(e))) throw new Error("boom\r\nBcc: x@y.z");
      raws.push(decoded);
      n += 1;
      return { threadId: `t${n}`, messageId: `m${n}` };
    },
    async markLead(u) { marks.push({ leadId: u.leadId, status: u.status }); },
    async recordCredits(c) { credits.push(c); return c; },
  };
  return { deps, store, raws, marks, credits };
}

const sendReq = (leadIds: string[], extra = {}) => ({ leadIds, subject: "Hi {{name}}", body: "Hello {{name}}", templateId: "plain" as const, ...extra });

// ---------- plan / cap / repeat / stop list / guessed ----------

test("cap: 25 per UTC day applied in selection order, the rest are over_cap", async () => {
  const { deps } = setup();
  const { plan } = await computePlan(deps, ids(30), false);
  assert.equal(plan.sendable.length, OUTREACH_DAILY_CAP);
  assert.deepEqual(plan.sendable, ids(25));
  assert.deepEqual(plan.blocked.map((b) => b.leadId), ["l25", "l26", "l27", "l28", "l29"]);
  assert.ok(plan.blocked.every((b) => b.reason === "over_cap"));
  assert.equal(plan.creditCost, 5);
  assert.equal(plan.status.remainingToday, 25);
});

test("cap: sends earlier today count, yesterday (UTC) does not, test sends are never logged", async () => {
  const { deps, store } = setup();
  const log = (email: string, at: Date) => store.recordSend({ userId: USER, projectId: null, leadId: null, email, sentAt: at, messageId: null });
  for (let i = 0; i < 20; i++) await log(`old${i}@x.com`, new Date(utcDayStart(NOW).getTime() + 1000));
  for (let i = 0; i < 10; i++) await log(`yday${i}@x.com`, new Date(utcDayStart(NOW).getTime() - 1000));
  await store.recordSend({ userId: "other", projectId: null, leadId: null, email: "o@x.com", sentAt: NOW, messageId: null });
  const { plan } = await computePlan(deps, ids(10), false);
  assert.equal(plan.status.sentToday, 20);
  assert.equal(plan.sendable.length, 5);
  assert.equal(plan.blocked.length, 5);

  // a test send leaves no trace in the log
  const t = await handleSend(deps, { ...sendReq([]), test: true });
  assert.equal(t.status, 200);
  assert.equal(store.sends.length, 31);
});

test("repeat window: exactly 30 days ago is allowed again, one second inside is blocked", async () => {
  const { deps, store } = setup();
  const sent = (email: string, at: Date) => store.recordSend({ userId: USER, projectId: null, leadId: null, email, sentAt: at, messageId: null });
  await sent("p0@example.com", new Date(NOW.getTime() - 30 * DAY));
  await sent("p1@example.com", new Date(NOW.getTime() - 30 * DAY + 1000));
  await sent("P2@Example.com".toLowerCase(), new Date(NOW.getTime() - 1 * DAY));
  const { plan } = await computePlan(deps, ["l0", "l1", "l2", "l3"], false);
  assert.deepEqual(plan.sendable, ["l0", "l3"]);
  assert.deepEqual(plan.blocked, [{ leadId: "l1", reason: "recent" }, { leadId: "l2", reason: "recent" }]);
});

test("repeat: same address twice in one selection, and across projects, is emailed once", async () => {
  const leads = [lead(0), lead(1, { email: "P0@Example.com" })];
  const { deps } = setup({ leads });
  const { plan } = await computePlan(deps, ["l0", "l1", "l0"], false);
  assert.deepEqual(plan.sendable, ["l0"]);
  assert.deepEqual(plan.blocked, [{ leadId: "l1", reason: "recent" }]);
});

test("stop list wins over everything and is per user", async () => {
  const { deps, store } = setup();
  await store.addOptout(USER, "p0@example.com", "unsubscribed");
  await store.addOptout(USER, "p1@example.com", "reply_stop");
  await store.addOptout("someone-else", "p2@example.com", "unsubscribed");
  const { plan } = await computePlan(deps, ["l0", "l1", "l2"], true);
  assert.deepEqual(plan.sendable, ["l2"]);
  assert.deepEqual(plan.blocked.map((b) => b.reason), ["unsubscribed", "unsubscribed"]);
});

test("no_email: missing, malformed and unknown leads", () => {
  const leads: PlanLead[] = [{ id: "a", email: null }, { id: "b", email: "not-an-email" }, { id: "c", email: "ok@x.com" }];
  const plan = planOutreach({ leadIds: ["a", "b", "c", "zzz"], leads, acceptGuessed: false, optedOut: new Set(), lastSent: new Map(), sentToday: 0, now: NOW });
  assert.deepEqual(plan.sendable, ["c"]);
  assert.deepEqual(plan.blocked.map((b) => b.reason), ["no_email", "no_email", "no_email"]);
});

test("guessed addresses are blocked unless accepted; guessedIds lists them; guessed do not eat the cap when blocked", async () => {
  const leads = [lead(0, { emailVerified: true }), lead(1), lead(2, { emailVerified: 1 }), lead(3, { emailQuality: "pattern_candidate" }), lead(4, { emailQuality: "source_found" })];
  const { deps } = setup({ leads });
  const off = (await computePlan(deps, ids(5), false)).plan;
  assert.deepEqual(off.sendable, ["l1", "l4"]);
  assert.deepEqual(off.blocked, [{ leadId: "l0", reason: "guessed" }, { leadId: "l2", reason: "guessed" }, { leadId: "l3", reason: "guessed" }]);
  assert.deepEqual(off.guessedIds, ["l0", "l2", "l3"]);
  const on = (await computePlan(deps, ids(5), true)).plan;
  assert.deepEqual(on.sendable, ids(5));
  assert.equal(on.blocked.length, 0);
  assert.equal(isGuessedLead({ emailVerified: false, emailQuality: "smtp_accept" }), false);
});

test("plan is deterministic", async () => {
  const { deps } = setup();
  const a = await computePlan(deps, ids(30), false);
  const b = await computePlan(deps, ids(30), false);
  assert.deepEqual(a.plan, b.plan);
});

// ---------- send ----------

test("send re-plans server-side: a stop-listed lead the client thought was fine is skipped with its reason", async () => {
  const { deps, store, raws } = setup();
  await store.addOptout(USER, "p1@example.com", "unsubscribed");
  const planned = await handlePlan(deps, { leadIds: ["l0", "l1", "l2"] });
  assert.equal(planned.status, 200);
  const res = await handleSend(deps, sendReq(["l0", "l1", "l2"]));
  assert.equal(res.status, 200);
  const body = res.body as Awaited<ReturnType<typeof handleSend>>["body"] & { results: Array<{ id: string; status: string; reason?: string }> };
  assert.deepEqual(body.results.map((r) => [r.id, r.status, r.reason]), [["l0", "sent", undefined], ["l1", "skipped", "unsubscribed"], ["l2", "sent", undefined]]);
  assert.equal(raws.length, 2);
  assert.equal(store.sends.length, 2);
});

test("send respects cap even when the client asks for more; status reflects the sends", async () => {
  const { deps, raws, credits } = setup();
  const res = await handleSend(deps, sendReq(ids(30)));
  const body = res.body as { results: Array<{ status: string; reason?: string }>; status: { sentToday: number; remainingToday: number }; creditsRecorded: number };
  assert.equal(raws.length, 25);
  assert.equal(body.results.filter((r) => r.status === "skipped" && r.reason === "over_cap").length, 5);
  assert.equal(body.status.sentToday, 25);
  assert.equal(body.status.remainingToday, 0);
  assert.equal(body.creditsRecorded, 5);
  assert.deepEqual(credits, [5]);
  const again = await handleSend(deps, sendReq(["l30"]));
  assert.equal((again.body as { results: Array<{ reason?: string }> }).results[0].reason, "over_cap");
});

test("credits: ceil(sent/5), only for emails actually sent, nothing when all fail or skipped", async () => {
  const leads = Array.from({ length: 8 }, (_, i) => lead(i));
  const a = setup({ leads, failFor: ["p0@", "p1@", "p2@"] });
  const res = await handleSend(a.deps, sendReq(ids(8)));
  const body = res.body as { results: Array<{ status: string; error?: string }>; creditsRecorded: number; status: { sentToday: number } };
  assert.equal(body.results.filter((r) => r.status === "sent").length, 5);
  assert.equal(body.results.filter((r) => r.status === "failed").length, 3);
  assert.equal(body.creditsRecorded, 1); // 5 sent -> 1 credit, not ceil(8/5)=2
  assert.equal(body.status.sentToday, 5);
  assert.ok(body.results.find((r) => r.status === "failed")!.error!.indexOf("\n") === -1);
  assert.equal(a.store.sends.length, 5);

  const b = setup({ leads, failFor: ["@example.com"] });
  const none = await handleSend(b.deps, sendReq(ids(8)));
  assert.equal((none.body as { creditsRecorded: number }).creditsRecorded, 0);
  assert.deepEqual(b.credits, []);

  const c = setup({ leads });
  const six = await handleSend(c.deps, sendReq(ids(6)));
  assert.equal((six.body as { creditsRecorded: number }).creditsRecorded, 2);
});

test("billing pre-check can refuse before anything is sent (never in beta, where canAfford is true)", async () => {
  const s = setup();
  s.deps.canAfford = async () => false;
  const res = await handleSend(s.deps, sendReq(["l0"]));
  assert.equal(res.status, 402);
  assert.equal(s.raws.length, 0);
});

test("fail closed: no signing secret or no app URL means 422 naming both settings and nothing is sent", async () => {
  for (const o of [{ secret: null }, { secret: "short" }, { appUrl: null }]) {
    const s = setup(o);
    const res = await handleSend(s.deps, sendReq(["l0"]));
    assert.equal(res.status, 422);
    const msg = (res.body as { error: string }).error;
    assert.match(msg, /NOTIFY_SIGNING_SECRET/);
    assert.match(msg, /NEXT_PUBLIC_APP_URL/);
    assert.equal(s.raws.length, 0);
    assert.equal(s.store.sends.length, 0);
  }
});

test("503 when the outreach tables are missing: status, plan and send, and nothing is sent", async () => {
  const s = setup({ missing: true });
  assert.deepEqual(await handleStatus(s.deps), { status: 503, body: { error: "Outreach safeguards are not set up yet" } });
  assert.deepEqual(await handlePlan(s.deps, { leadIds: ["l0"] }), { status: 503, body: { error: "Outreach safeguards are not set up yet" } });
  assert.deepEqual(await handleSend(s.deps, sendReq(["l0"])), { status: 503, body: { error: "Outreach safeguards are not set up yet" } });
  assert.equal(s.raws.length, 0);
});

test("test send goes only to the connected address, with a placeholder unsubscribe link, no cap/log/credits/lead updates", async () => {
  const s = setup({ secret: null, appUrl: null, missing: true });
  const res = await handleSend(s.deps, { ...sendReq(["l0", "l1"]), test: true });
  assert.equal(res.status, 200);
  const body = res.body as { results: Array<{ id: string; status: string }>; creditsRecorded: number };
  assert.deepEqual(body.results.map((r) => [r.id, r.status]), [["test", "sent"]]);
  assert.equal(body.creditsRecorded, 0);
  assert.equal(s.raws.length, 1);
  assert.match(s.raws[0], /^To: me@gmail\.test$/m);
  assert.doesNotMatch(s.raws[0], /List-Unsubscribe/);
  assert.equal(s.marks.length, 0);
  assert.equal(s.credits.length, 0);
});

test("real sends carry a per-lead signed unsubscribe link and List-Unsubscribe headers", async () => {
  const s = setup();
  await handleSend(s.deps, sendReq(["l3"]));
  const raw = s.raws[0];
  const url = /^List-Unsubscribe: <(.+)>$/m.exec(raw)?.[1];
  assert.ok(url);
  assert.match(raw, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  const token = new URL(url!).searchParams.get("token");
  assert.equal(new URL(url!).pathname, "/api/outreach/unsubscribe");
  assert.deepEqual(verifyToken(token, "lead-unsubscribe", SECRET), { userId: USER, email: "p3@example.com", leadId: "l3" });
  assert.equal(s.store.sends[0].email, "p3@example.com");
  assert.equal(s.store.sends[0].projectId, "proj-1");
  assert.deepEqual(s.marks, [{ leadId: "l3", status: "sent" }]);
});

test("parseSendRequest validates and defaults", () => {
  assert.equal(parseSendRequest({ leadIds: [], subject: "a", body: "b" }).ok, false);
  assert.equal(parseSendRequest({ leadIds: ["a"], subject: " ", body: "b" }).ok, false);
  const ok = parseSendRequest({ leadIds: ["a", 3], subject: "s", body: "b", templateId: "nope", acceptGuessed: "yes" });
  assert.ok(ok.ok && ok.req.templateId === "plain" && ok.req.acceptGuessed === false && ok.req.leadIds.length === 1);
  assert.equal(parseSendRequest({ leadIds: [], subject: "s", body: "b", test: true }).ok, true);
});

// ---------- MIME ----------

test("MIME: multipart/alternative with text then html, CRLF only, base64url round trip", () => {
  const raw = buildOutreachMime({ fromEmail: "me@x.com", fromName: "Me", toEmail: "you@y.com", subject: "Hello", text: "plain body", html: "<p>html body</p>", boundary: "BND" });
  assert.ok(!/(^|[^\r])\n/.test(raw), "bare LF found");
  assert.match(raw, /Content-Type: multipart\/alternative; boundary="BND"/);
  const [head, ...parts] = raw.split("--BND");
  assert.match(head, /^From: "Me" <me@x\.com>\r\nTo: you@y\.com\r\nSubject: Hello\r\nMIME-Version: 1\.0/);
  assert.match(parts[0], /text\/plain; charset=UTF-8/);
  assert.match(parts[1], /text\/html; charset=UTF-8/);
  assert.match(parts[2], /^--/);
  const b64 = (p: string) => Buffer.from(p.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.equal(b64(parts[0]), "plain body");
  assert.equal(b64(parts[1]), "<p>html body</p>");
  assert.equal(Buffer.from(base64Url(raw), "base64url").toString("utf8"), raw);
  assert.ok(!/[+/=]/.test(base64Url(raw)));
});

test("MIME: header injection attempts in subject, name and extra headers cannot add headers", () => {
  const raw = buildOutreachMime({
    fromEmail: "me@x.com", fromName: 'Evil"\r\nBcc: a@b.com', toEmail: "you@y.com",
    subject: "Hi\r\nBcc: victim@z.com\nX-Evil: 1", text: "t", html: "h",
    headers: { "List-Unsubscribe": "<https://a.b/u>\r\nBcc: c@d.com", "X-Bad\r\nName": "v", Subject: "override", "To": "z@z.com" },
  });
  const head = raw.split("\r\n\r\n")[0];
  const names = head.split("\r\n").map((l) => l.split(":")[0]);
  assert.ok(!names.some((n) => n === "Bcc" || n === "X-Evil"), head);
  assert.equal(names.filter((n) => n === "Subject").length, 1);
  assert.equal(names.filter((n) => n === "To").length, 1);
  assert.match(head, /^List-Unsubscribe: <https:\/\/a\.b\/u> Bcc: c@d\.com$/m);
  assert.throws(() => buildOutreachMime({ fromEmail: "me@x.com", toEmail: "a@b.com\r\nBcc: x@y.com", subject: "s", text: "t", html: "h" }));
});

test("MIME: non-ASCII subject is RFC 2047 encoded, folded, never splitting a code point", () => {
  const subject = "Café ☕ — 日本語のテスト 🚀 ".repeat(4);
  const enc = encodeHeaderText(subject);
  const words = enc.split("\r\n ");
  assert.ok(words.length > 1);
  for (const w of words) {
    assert.match(w, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    assert.ok(w.length <= 75);
  }
  const decoded = words.map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf8")).join("");
  assert.equal(decoded, subject.trim());
  assert.equal(encodeHeaderText("Plain subject"), "Plain subject");
  assert.ok(!/[\r\n]/.test(encodeHeaderText("a\r\nb").replace(/\r\n /g, "")));
});

// ---------- tokens ----------

test("token: sign/verify round trip with email and leadId; wrong scope, tampering, expiry, bad secret all fail", () => {
  const t = signToken({ userId: USER, scope: "lead-unsubscribe", email: "a@b.com", leadId: "L" }, SECRET)!;
  assert.deepEqual(verifyToken(t, "lead-unsubscribe", SECRET), { userId: USER, email: "a@b.com", leadId: "L" });
  assert.equal(verifyToken(t, "unsubscribe", SECRET), null);
  const general = signToken({ userId: USER, scope: "unsubscribe" }, SECRET)!;
  assert.equal(verifyToken(general, "lead-unsubscribe", SECRET), null);
  assert.equal(verifyToken(t, "lead-unsubscribe", "another-secret-0123456789"), null);
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), m: "victim@x.com" })).toString("base64url");
  assert.equal(verifyToken(`${forged}.${sig}`, "lead-unsubscribe", SECRET), null);
  assert.equal(verifyToken(`${body}.${sig.slice(0, -2)}AA`, "lead-unsubscribe", SECRET), null);
  const old = signToken({ userId: USER, scope: "lead-unsubscribe", email: "a@b.com", ttlSeconds: 10, now: new Date(NOW.getTime() - 60_000) }, SECRET);
  assert.equal(verifyToken(old, "lead-unsubscribe", SECRET, NOW), null);
  assert.equal(signToken({ userId: USER, scope: "lead-unsubscribe", email: "a@b.com" }, "short"), null);
  assert.equal(verifyToken(t, "lead-unsubscribe", null), null);
  // the existing user-level token shape is unchanged
  assert.deepEqual(verifyToken(general, "unsubscribe", SECRET), { userId: USER });
});

// ---------- unsubscribe ----------

test("unsubscribe: checking a token (GET) has no side effect; applying it (POST) records an opt-out", async () => {
  const store = memoryOutreachStore();
  const token = signToken({ userId: USER, scope: "lead-unsubscribe", email: "Person@Example.com " }, SECRET)!;
  assert.equal(checkUnsubscribeToken(token, SECRET), true);
  assert.equal(store.optouts.size, 0);
  assert.equal(await applyUnsubscribe(store, token, SECRET), "ok");
  assert.equal(store.optouts.get(USER)?.get("person@example.com"), "unsubscribed");
  assert.equal(await applyUnsubscribe(store, token, SECRET), "ok"); // idempotent
  assert.equal(store.optouts.get(USER)?.size, 1);
  assert.equal(await applyUnsubscribe(store, "garbage", SECRET), "invalid");
  assert.equal(await applyUnsubscribe(store, token, null), "invalid");
  const noEmail = signToken({ userId: USER, scope: "lead-unsubscribe" }, SECRET);
  assert.equal(await applyUnsubscribe(store, noEmail, SECRET), "invalid");
  assert.equal(await applyUnsubscribe(memoryOutreachStore({ missing: true }), token, SECRET), "unavailable");
});

test("unsubscribed address is then blocked by the next plan", async () => {
  const s = setup();
  const token = signToken({ userId: USER, scope: "lead-unsubscribe", email: "p0@example.com" }, SECRET)!;
  await applyUnsubscribe(s.store, token, SECRET);
  const { plan } = await computePlan(s.deps, ["l0", "l1"], false);
  assert.deepEqual(plan.blocked, [{ leadId: "l0", reason: "unsubscribed" }]);
});

// ---------- reply stop detection ----------

test("reply stop: clear requests are detected", () => {
  for (const t of [
    "Stop", "stop.", "STOP!", "Please stop emailing me", "Unsubscribe", "please unsubscribe me from this list", "Remove me",
    "Remove me from your list please", "Do not contact me again", "Don't email me anymore.", "Hi John, please remove me from your mailing list.",
    "Thanks, but I want to opt out.", "Opt out", "stop contacting us\n\nOn Mon, Oct 5, 2026 at 3:00 PM Me <me@x.com> wrote:\n> hello there",
    "Hello,\n\nPlease stop.\n\nRegards",
  ]) assert.equal(isStopRequest(t), true, t);
});

test("reply stop: false positives are not detected", () => {
  for (const t of [
    "please stop by our booth", "Not interested, thanks", "Can you tell me how to unsubscribe from the other newsletter?",
    "We stopped using that tool last year", "Stop me if you've heard this, but we would love a demo", "Sounds good, let's talk Tuesday",
    "", "Thanks for reaching out! Remove me from nothing, I'm happy to chat.".replace("Remove me from nothing, ", ""),
    "Interested! Do not hesitate to call.", "Hi,\n\nI'd love to learn more.\n\n> Please stop emailing me\n> (quoted from your own text)",
    "I will stop by next week. Unsubscribe links are good practice, by the way.",
    "Great, our team will stop the old process and start fresh " + "x".repeat(400) + " stop",
  ]) assert.equal(isStopRequest(t), false, t);
});

test("reply stop: only the first ~300 chars of the reply count", () => {
  assert.equal(isStopRequest("Hello there. ".repeat(40) + "Please stop emailing me"), false);
});

test("recordReplyStops records reply_stop for the lead address only on a stop reply, and tolerates missing tables", async () => {
  const store = memoryOutreachStore();
  assert.equal(await recordReplyStops(store, USER, "Lead@Example.com", ["Sounds great", "Tell me more"]), false);
  assert.equal(store.optouts.size, 0);
  assert.equal(await recordReplyStops(store, USER, "Lead@Example.com", ["Sounds great", "Please stop emailing me"]), true);
  assert.equal(store.optouts.get(USER)?.get("lead@example.com"), "reply_stop");
  assert.equal(await recordReplyStops(store, USER, null, ["stop"]), false);
  assert.equal(await recordReplyStops(memoryOutreachStore({ missing: true }), USER, "a@b.com", ["stop"]), false);
});

test("plainTextFromGmailPayload finds nested text/plain", () => {
  const data = Buffer.from("Please stop").toString("base64url");
  assert.equal(plainTextFromGmailPayload({ mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: "x" } }, { mimeType: "text/plain", body: { data } }] }), "Please stop");
  assert.equal(plainTextFromGmailPayload(undefined), "");
});

// ---------- sqlite twin ----------

test("sqlite store behaves like the memory store, and a missing table reads as not set up", async () => {
  const bare = new Database(":memory:");
  await assert.rejects(sqliteOutreachStore(bare).countSince("u", NOW), OutreachNotSetUpError);

  const db = new Database(":memory:");
  db.exec(`CREATE TABLE outreach_optouts (user_id TEXT NOT NULL, email TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, email));
    CREATE TABLE outreach_sends (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, lead_id TEXT, email TEXT NOT NULL, sent_at TEXT NOT NULL, message_id TEXT);`);
  const store = sqliteOutreachStore(db);
  await store.recordSend({ userId: "u", projectId: "p", leadId: "l", email: "a@x.com", sentAt: new Date(NOW.getTime() - 5 * DAY), messageId: "m" });
  await store.recordSend({ userId: "u", projectId: null, leadId: null, email: "a@x.com", sentAt: new Date(NOW.getTime() - DAY), messageId: null });
  await store.recordSend({ userId: "v", projectId: null, leadId: null, email: "a@x.com", sentAt: NOW, messageId: null });
  assert.equal(await store.countSince("u", new Date(NOW.getTime() - 2 * DAY)), 1);
  assert.equal((await store.lastSends("u", ["a@x.com", "b@x.com"], new Date(NOW.getTime() - 30 * DAY))).get("a@x.com")?.toISOString(), new Date(NOW.getTime() - DAY).toISOString());
  await store.addOptout("u", "a@x.com", "reply_stop");
  await store.addOptout("u", "a@x.com", "unsubscribed");
  assert.deepEqual([...(await store.optedOut("u", ["a@x.com", "b@x.com"]))], ["a@x.com"]);
  assert.equal((await store.optedOut("v", ["a@x.com"])).size, 0);
});
