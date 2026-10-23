import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_LIMIT_MESSAGE, checkChatAllowance, chatFeatureGate, chatToolPolicy, chatLimitBody, resolveChatToolPolicy, utcMonthWindow,
  type ChatEntitlement, type EntitlementPort,
} from "../lib/domain/assistant/chatEntitlements.ts";
import { runAssistantTurn, type AssistantPorts } from "../lib/domain/assistant/assistantService.ts";
import { AssistantError, type TurnContext } from "../lib/domain/assistant/assistantTypes.ts";
import { buildToolDefs, buildAutoSummary } from "../lib/domain/chat/toolLoop.ts";
import { chatMeterView } from "../lib/domain/chat/chatMeter.ts";
import { describeChatFailure } from "../lib/domain/chat/chatSessionState.ts";
import { buildPlanInfo } from "../lib/domain/plans/planInfo.ts";
import { createUnlockTrigger } from "../lib/ui/unlockTrigger.ts";
import { shouldShowUnlockPanel } from "../lib/domain/plans/unlockPanel.ts";
import { PLAN_LIMITS } from "../lib/domain/plans/planMatrix.ts";
import { buildPlanCard, buildPlanCards } from "../lib/domain/plans/pricingView.ts";
import type { ChatPorts } from "../lib/domain/chat/tools.ts";

const ctx: TurnContext = { mode: "platform", userId: "u1", activeProjectId: null };
const NOW = new Date("2026-10-15T12:00:00Z");

/** Fake usage table: only counts rows that are ok, chat_message and inside the window (BYOK writes no row at all). */
type Row = { at: string; status: "ok" | "failed" | "refunded"; agent: string };
function port(ent: ChatEntitlement, rows: Row[] = [], calls: string[] = []): EntitlementPort {
  return {
    entitlement: async () => { calls.push("ent"); return ent; },
    countPlatformChatMessages: async (_c, from, to) => {
      calls.push("count");
      return rows.filter((r) => r.agent === "chat_message" && r.status === "ok" && new Date(r.at) >= from && new Date(r.at) < to).length;
    },
  };
}
const ok = (at: string): Row => ({ at, status: "ok", agent: "chat_message" });

test("matrix: chat messages per month and the two paid chat features, exposed through PlanInfo", () => {
  assert.deepEqual(PLAN_LIMITS.chat_messages_per_month, { free: 10, lite: 150, pro: 600 });
  const free = buildPlanInfo({ plan: "free", enforced: true });
  assert.equal(free.limits.chat_messages_per_month, 10);
  assert.equal(free.features.chat_start_audit, false);
  assert.equal(free.features.chat_deep_tools, false);
  for (const plan of ["lite", "pro"] as const) {
    const i = buildPlanInfo({ plan, enforced: true });
    assert.equal(i.features.chat_start_audit, true);
    assert.equal(i.features.chat_deep_tools, true);
  }
  assert.equal(buildPlanInfo({ plan: "selfhost", enforced: false }).limits.chat_messages_per_month, -1);
  assert.equal(buildPlanInfo({ plan: "free", enforced: false }).features.chat_deep_tools, true);
});

test("pricing view: chat row on every card and paid chat features on Lite", () => {
  for (const c of buildPlanCards()) {
    const row = c.rows.find((r) => r.id === "chat");
    assert.ok(row, c.id);
    assert.equal(row.label, "Chat messages per month");
  }
  assert.equal(buildPlanCard("free").rows.find((r) => r.id === "chat")?.limitText, "10 / month");
  assert.equal(buildPlanCard("lite").rows.find((r) => r.id === "chat")?.limitText, "150 / month");
  assert.equal(buildPlanCard("pro").rows.find((r) => r.id === "chat")?.limitText, "600 / month");
  const lite = buildPlanCard("lite").rows.map((r) => r.id);
  assert.ok(lite.includes("chat_start_audit") && lite.includes("chat_deep_tools"));
  assert.ok(!buildPlanCard("free").rows.map((r) => r.id).includes("chat_deep_tools"));
});

test("month boundary is UTC", () => {
  const w = utcMonthWindow(new Date("2026-10-31T23:59:59.999Z"));
  assert.equal(w.start.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(utcMonthWindow(new Date("2026-11-01T00:00:00.000Z")).start.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(utcMonthWindow(new Date("2026-12-31T23:59:59Z")).end.toISOString(), "2027-01-01T00:00:00.000Z");
});

test("last second of the month counts for that month; first second of the next does not", async () => {
  const rows = [ok("2026-10-31T23:59:59Z"), ok("2026-11-01T00:00:00Z"), ok("2026-09-30T23:59:59Z")];
  const p = port({ plan: "free", enforced: true }, rows);
  const oct = await checkChatAllowance(p, ctx, { now: new Date("2026-10-31T23:59:59Z") });
  assert.equal(oct.used, 1);
  const nov = await checkChatAllowance(p, ctx, { now: new Date("2026-11-01T00:00:00Z") });
  assert.equal(nov.used, 1);
  assert.equal(nov.resetsAt, "2026-12-01T00:00:00.000Z");
});

test("not enforced => always allowed, and no usage query", async () => {
  const calls: string[] = [];
  const rows = Array.from({ length: 50 }, () => ok("2026-10-02T00:00:00Z"));
  const a = await checkChatAllowance(port({ plan: "free", enforced: false }, rows, calls), ctx, { now: NOW });
  assert.equal(a.allowed, true);
  assert.equal(a.enforced, false);
  assert.ok(!calls.includes("count"));
});

test("self-host is exempt without any lookup", async () => {
  const calls: string[] = [];
  const sh = await checkChatAllowance(port({ plan: "selfhost", enforced: false }, [], calls), { ...ctx, mode: "selfhost" }, { now: NOW });
  assert.equal(sh.allowed, true);
  assert.equal(sh.limit, -1);
  assert.deepEqual(calls, []);
  const sh2 = await checkChatAllowance(port({ plan: "selfhost", enforced: true }, [], calls), ctx, { now: NOW });
  assert.equal(sh2.allowed, true);
});

test("counts only successful platform chat messages", async () => {
  const rows: Row[] = [
    ok("2026-10-02T00:00:00Z"),
    { at: "2026-10-03T00:00:00Z", status: "failed", agent: "chat_message" },
    { at: "2026-10-04T00:00:00Z", status: "refunded", agent: "chat_message" },
    { at: "2026-10-05T00:00:00Z", status: "ok", agent: "seo_audit" },
  ];
  const a = await checkChatAllowance(port({ plan: "free", enforced: true }, rows), ctx, { now: NOW });
  assert.equal(a.used, 1);
  assert.equal(a.remaining, 9);
  assert.equal(a.allowed, true);
});

test("free cap reached => denied; lite and pro caps follow the matrix", async () => {
  const ten = Array.from({ length: 10 }, () => ok("2026-10-02T00:00:00Z"));
  const free = await checkChatAllowance(port({ plan: "free", enforced: true }, ten), ctx, { now: NOW });
  assert.equal(free.allowed, false);
  assert.equal(free.remaining, 0);
  const lite = await checkChatAllowance(port({ plan: "lite", enforced: true }, ten), ctx, { now: NOW });
  assert.equal(lite.allowed, true);
  assert.equal(lite.limit, 150);
  assert.equal((await checkChatAllowance(port({ plan: "pro", enforced: true }), ctx, { now: NOW })).limit, 600);
});

test("lookup failures never block the user", async () => {
  const bad: EntitlementPort = { entitlement: async () => { throw new Error("x"); }, countPlatformChatMessages: async () => 0 };
  assert.equal((await checkChatAllowance(bad, ctx, { now: NOW })).allowed, true);
  const bad2: EntitlementPort = { entitlement: async () => ({ plan: "free", enforced: true }), countPlatformChatMessages: async () => { throw new Error("x"); } };
  assert.equal((await checkChatAllowance(bad2, ctx, { now: NOW })).allowed, true);
});

// ---- service wiring ----
const chatPorts = {
  getSearchSnapshot: async () => null, listFindings: async () => [], getFinding: async () => null, recommendationsFor: () => [],
  listActionsWithOutcomes: async () => [], getLeadSummary: async () => ({ total: 0, emailed: 0, replied: 0 }),
  getGeoStatus: async () => ({ checkedAt: "2026-10-01T00:00:00Z", rows: [] }),
  getAuditSummary: async () => ({ checkedAt: "2026-10-01T00:00:00Z", errors: 1, warnings: 2 }),
  listCompetitors: async () => [], now: () => NOW,
} as unknown as ChatPorts;

function service(opts: { cred: "byok" | "platform"; ent: ChatEntitlement; used: number; platformIds?: string[] }) {
  const events: string[] = [];
  const systems: string[] = [];
  const checks: string[] = [];
  const rows = Array.from({ length: opts.used }, () => ok(new Date().toISOString()));
  const base = port(opts.ent, rows);
  const platformIds = opts.platformIds ?? ["groq", "mistral"];
  const ports: AssistantPorts = {
    scope: { authenticate: async () => ({ userId: "u1" }), activeProjectId: async () => "p1" },
    llm: { getDriver: () => async (req) => { systems.push(req.system ?? ""); return { text: "hi" }; }, supportsTools: () => false },
    credentials: {
      resolve: async (_c, id) => (opts.cred === "byok" ? { kind: "byok", apiKey: "k", baseUrl: undefined } : platformIds.includes(id) ? { kind: "platform", loadApiKey: () => "pk" } : { kind: "missing" }),
      preferredModel: async () => (opts.cred === "byok" ? { providerId: "anthropic", model: "m" } : null),
      platformAvailable: (id) => platformIds.includes(id),
    },
    credits: {
      canAfford: async () => { events.push("canAfford"); return { ok: true }; },
      charge: async () => { events.push("charge"); return { ok: true }; },
    },
    prompts: { build: async () => "SYS" },
    data: { create: () => chatPorts },
    entitlements: { ...base, countPlatformChatMessages: async (c, f, t) => { checks.push("count"); return base.countPlatformChatMessages(c, f, t); } },
  };
  return { ports, events, systems, checks };
}
const input = { message: "hello", history: [], projectId: "p1" };
const turnCtx: TurnContext = { mode: "platform", userId: null, activeProjectId: null };

test("service denies with 402 chat_limit body and does not charge", async () => {
  const { ports, events } = service({ cred: "platform", ent: { plan: "free", enforced: true }, used: 10 });
  await assert.rejects(runAssistantTurn(ports, turnCtx, input), (e: unknown) => {
    assert.ok(e instanceof AssistantError);
    assert.equal(e.status, 402);
    assert.equal(e.userMessage, "You have used your free chats for this month.");
    assert.equal(e.body?.code, "chat_limit");
    assert.equal(e.body?.used, 10);
    assert.equal(e.body?.limit, 10);
    assert.equal(e.body?.plan, "free");
    assert.match(String(e.body?.resetsAt), /^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    return true;
  });
  assert.deepEqual(events, []);
});

test("denial with the fallback loop: exactly one check, zero fallbacks, zero charges, chat_limit body kept", async () => {
  const s = service({ cred: "platform", ent: { plan: "free", enforced: true }, used: 10 });
  const drivers: string[] = [];
  const getDriver = s.ports.llm.getDriver;
  s.ports.llm.getDriver = (id) => { const d = getDriver(id); return d && (async (r) => { drivers.push(id); return d(r); }); };
  await assert.rejects(runAssistantTurn(s.ports, turnCtx, input), (e: unknown) => {
    assert.ok(e instanceof AssistantError);
    assert.equal(e.status, 402);
    assert.equal(e.body?.code, "chat_limit");
    return true;
  });
  assert.deepEqual(s.checks, ["count"]);
  assert.deepEqual(drivers, []);
  assert.deepEqual(s.events, []);
});

test("service: BYOK exempt, not-enforced exempt, under cap allowed", async () => {
  assert.equal((await runAssistantTurn(service({ cred: "byok", ent: { plan: "free", enforced: true }, used: 99 }).ports, turnCtx, input)).reply, "hi");
  assert.equal((await runAssistantTurn(service({ cred: "platform", ent: { plan: "free", enforced: false }, used: 99 }).ports, turnCtx, input)).reply, "hi");
  assert.equal((await runAssistantTurn(service({ cred: "platform", ent: { plan: "free", enforced: true }, used: 9 }).ports, turnCtx, input)).reply, "hi");
});

test("deny body shape", () => {
  const b = chatLimitBody({ allowed: false, used: 10, limit: 10, remaining: 0, resetsAt: "2026-11-01T00:00:00.000Z", plan: "free", enforced: true });
  assert.deepEqual(b, { error: CHAT_LIMIT_MESSAGE, code: "chat_limit", used: 10, limit: 10, resetsAt: "2026-11-01T00:00:00.000Z", plan: "free" });
});

// ---- tool gating ----
test("tool gating per plan; everything available when not enforced", async () => {
  const names = (locked: string[]) => buildToolDefs(chatPorts, [], locked).map((t) => t.name);
  const freePolicy = chatToolPolicy(chatFeatureGate({ plan: "free", enforced: true }));
  assert.deepEqual([...freePolicy.lockedTools].sort(), ["get_audit_summary", "get_geo_status"]);
  assert.ok(!names(freePolicy.lockedTools).includes("get_geo_status"));
  assert.ok(names(freePolicy.lockedTools).includes("list_findings"));
  assert.match(freePolicy.note, /paid plan/);
  const open: ChatEntitlement[] = [{ plan: "lite", enforced: true }, { plan: "pro", enforced: true }, { plan: "free", enforced: false }, { plan: "selfhost", enforced: false }];
  for (const ent of open) {
    const p = chatToolPolicy(chatFeatureGate(ent));
    assert.deepEqual(p.lockedTools, [], ent.plan);
    assert.equal(p.note, "");
  }
  assert.equal(chatFeatureGate({ plan: "free", enforced: true }).canUse("chat_start_audit"), false);
  assert.equal(chatFeatureGate({ plan: "free", enforced: false }).canUse("chat_start_audit"), true);
  assert.equal(chatFeatureGate({ plan: "pro", enforced: true }).canUse("chat_start_audit"), true);
  assert.deepEqual(await resolveChatToolPolicy(undefined, ctx), { lockedTools: [], note: "" });
});

test("locked tools are also left out of the no-tools context summary", async () => {
  const full = await buildAutoSummary(chatPorts, []);
  assert.match(full, /Site audit/);
  assert.match(full, /GEO check/);
  const locked = await buildAutoSummary(chatPorts, ["get_audit_summary", "get_geo_status"]);
  assert.doesNotMatch(locked, /Site audit|GEO check/);
});

test("service gives the model the paid-plan note for a free enforced user only", async () => {
  const s = service({ cred: "byok", ent: { plan: "free", enforced: true }, used: 0 });
  await runAssistantTurn(s.ports, turnCtx, input);
  assert.match(s.systems[0], /needs a paid plan/);
  assert.doesNotMatch(s.systems[0], /GEO check/);
  const t = service({ cred: "byok", ent: { plan: "pro", enforced: true }, used: 0 });
  await runAssistantTurn(t.ports, turnCtx, input);
  assert.doesNotMatch(t.systems[0], /paid plan/);
});

// ---- client side ----
test("chat_limit failure message and flag", () => {
  const f = describeChatFailure({ error: CHAT_LIMIT_MESSAGE, code: "chat_limit", limit: 10 });
  assert.equal(f.limitReached, true);
  assert.equal(f.message, "You've used your 10 free chats this month. Plans unlock more.");
  const g = describeChatFailure({ error: "Boom" });
  assert.equal(g.limitReached, false);
  assert.match(g.message, /Boom/);
});

test("unlockTrigger notifies subscribers once per fire and unsubscribes", () => {
  const t = createUnlockTrigger();
  let n = 0;
  const off = t.subscribe(() => { n += 1; });
  t.subscribe(() => { throw new Error("bad listener"); });
  t.fire();
  assert.equal(n, 1);
  off();
  t.fire();
  assert.equal(n, 1);
});

test("a forced unlock panel shows despite a recent dismissal, but never off the free plan", () => {
  const now = Date.now();
  assert.equal(shouldShowUnlockPanel({ plan: "free", dismissedAt: now - 1000, now }), false);
  assert.equal(shouldShowUnlockPanel({ plan: "free", dismissedAt: now - 1000, now, forced: true }), true);
  assert.equal(shouldShowUnlockPanel({ plan: "pro", dismissedAt: null, now, forced: true }), false);
  assert.equal(shouldShowUnlockPanel({ plan: undefined, dismissedAt: null, now, forced: true }), false);
});

test("usage meter: free + enforced only, amber at 3 or fewer", () => {
  const base = { limit: 10, plan: "free", enforced: true };
  assert.deepEqual(chatMeterView({ ...base, remaining: 7 }), { text: "7 of 10 chats left this month", amber: false });
  assert.equal(chatMeterView({ ...base, remaining: 4 })?.amber, false);
  assert.equal(chatMeterView({ ...base, remaining: 3 })?.amber, true);
  assert.equal(chatMeterView({ ...base, remaining: 0 })?.text, "0 of 10 chats left this month");
  assert.equal(chatMeterView({ ...base, remaining: 7, enforced: false }), null);
  assert.equal(chatMeterView({ ...base, remaining: 100, plan: "lite", limit: 150 }), null);
  assert.equal(chatMeterView({ ...base, remaining: -1, limit: -1, plan: "selfhost" }), null);
  assert.equal(chatMeterView(undefined), null);
});
