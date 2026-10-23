import { test } from "node:test";
import * as assert from "node:assert";
import { runAssistantTurn, type AssistantPorts } from "../lib/domain/assistant/assistantService.ts";
import { AssistantError, type TurnContext } from "../lib/domain/assistant/assistantTypes.ts";
import { assistantHealthResponse } from "../lib/domain/assistant/healthEndpoint.ts";
import { buildTurnLogLine, createMetrics, createTurnTelemetry, hashUserId, percentile, type TurnProbe } from "../lib/domain/assistant/turnLog.ts";
import type { ChatPorts } from "../lib/domain/chat/tools.ts";

const EMAIL = "jane.doe@secretcorp.com";
const TOKEN = "sk-live-AbCdEf0123456789XyZ9876543210";
const MESSAGE = "my private question about Project Falcon revenue";
const USER = "user-uuid-1234-5678";

const chatPorts = {
  getSearchSnapshot: async () => null, listFindings: async () => [], getFinding: async () => null, recommendationsFor: () => [],
  listActionsWithOutcomes: async () => [], getLeadSummary: async () => ({ total: 0, emailed: 0, replied: 0 }),
  getGeoStatus: async () => null, getAuditSummary: async () => null, listCompetitors: async () => [], now: () => new Date("2026-10-23T00:00:00Z"),
} as unknown as ChatPorts;

function ports(o: { fail?: boolean; reply?: string; tool?: boolean; failFirst?: boolean } = {}): AssistantPorts {
  let n = 0;
  return {
    scope: { authenticate: async () => ({ userId: USER }), activeProjectId: async () => "p1" },
    llm: {
      supportsTools: () => true,
      getDriver: () => async (req) => {
        n += 1;
        if (o.fail || (o.failFirst && n === 1)) throw Object.assign(new Error(`boom ${EMAIL} ${TOKEN}`), { status: 429 });
        if (o.tool !== false) await req.tools?.find((t) => t.name === "get_audit_summary")?.execute({});
        return { text: o.reply ?? `Hello ${EMAIL}, you have 4242 clicks. ${TOKEN}` };
      },
    },
    credentials: { resolve: async () => ({ kind: "byok", apiKey: TOKEN }) },
    credits: { chargeBeforeAnswer: async () => ({ ok: true }) },
    prompts: { build: async () => "SYS" },
    data: { create: () => chatPorts },
  };
}
const ctx: TurnContext = { mode: "platform", userId: null, activeProjectId: null };
const input = { message: MESSAGE, history: [], projectId: "p1", requestedProvider: "anthropic", requestedModel: "claude-x" };

async function turn(p: AssistantPorts, plan = "free") {
  const lines: string[] = [];
  const t = createTurnTelemetry({ write: (l) => lines.push(l), salt: "pepper", now: () => new Date("2026-10-23T10:00:00Z") });
  let err: unknown = null;
  try { await t.run(() => runAssistantTurn(t.wrapPorts(p), ctx, input), { plan }); } catch (e) { err = e; }
  return { lines, t, err };
}

test("log line has the expected shape and none of the sensitive content", async () => {
  const { lines } = await turn(ports());
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(line).sort(), ["attempts", "candidateIndex", "errorKind", "evt", "fallback", "groundingFlags", "model", "ok", "plan", "provider", "t", "toolMs", "tools", "totalMs", "u"]);
  assert.equal(line.ok, true);
  assert.equal(line.provider, "anthropic");
  assert.equal(line.model, "claude-x");
  assert.deepEqual(line.tools, ["get_audit_summary"]);
  assert.equal(line.plan, "free");
  assert.ok(line.groundingFlags >= 1, "4242 is invented");
  for (const secret of [EMAIL, TOKEN, MESSAGE, USER, "Falcon", "secretcorp", "4242", "SYS"]) {
    assert.ok(!lines[0].includes(secret), `leaked ${secret}`);
  }
  assert.equal(line.u, hashUserId(USER, "pepper"));
  assert.match(line.u, /^[0-9a-f]{12}$/);
});

test("failed turn: errorKind logged, error text and secrets are not", async () => {
  const { lines, err } = await turn(ports({ fail: true }));
  assert.ok(err instanceof AssistantError);
  const line = JSON.parse(lines[0]);
  assert.equal(line.ok, false);
  assert.equal(line.errorKind, "rate_limit");
  assert.equal(line.attempts, 1);
  for (const secret of [EMAIL, TOKEN, MESSAGE, USER]) assert.ok(!lines[0].includes(secret), `leaked ${secret}`);
});

test("free-form fields that look like secrets or contain content are replaced", () => {
  const probe: TurnProbe = { userId: null, plan: `plan ${EMAIL}`, toolMs: 3, groundingFlags: 0, attempts: 1, candidates: ["a/b"], lastCandidate: null };
  const line = buildTurnLogLine(
    { modelUsed: { providerId: TOKEN, model: "my message text with spaces" }, toolsUsed: ["get_search_summary", EMAIL, "Bad Tool"], durationMs: 12, errorKind: `x ${EMAIL}` },
    probe, new Date(0),
  );
  const s = JSON.stringify(line);
  assert.ok(!s.includes(EMAIL) && !s.includes(TOKEN) && !s.includes("my message"));
  assert.deepEqual(line.tools, ["get_search_summary"]);
  assert.equal(line.provider, "other");
  assert.equal(line.plan, "unknown");
  assert.equal(line.u, null);
});

test("hashUserId: salted differs from unsalted, deterministic, never contains the id", () => {
  assert.equal(hashUserId("u1", "s"), hashUserId("u1", "s"));
  assert.notEqual(hashUserId("u1", "s"), hashUserId("u1", undefined));
  assert.notEqual(hashUserId("u1", "s"), hashUserId("u2", "s"));
  assert.ok(!hashUserId("u1", undefined).includes("u1"));
});

test("fallback across candidates is visible via attempts/candidateIndex when models differ", async () => {
  // Two drivers calls on different models within one turn.
  const lines: string[] = [];
  const t = createTurnTelemetry({ write: (l) => lines.push(l) });
  const base = ports();
  const p = t.wrapPorts({ ...base, llm: { ...base.llm, getDriver: () => async () => ({ text: "ok" }) } });
  await t.run(async () => {
    const d = p.llm.getDriver("anthropic")!;
    await d({ apiKey: "k", model: "m1", messages: [{ role: "user", content: "hi" }] });
    await d({ apiKey: "k", model: "m2", messages: [{ role: "user", content: "hi" }] });
    p.observer!.onTurn({ modelUsed: { providerId: "anthropic", model: "m2" }, toolsUsed: [], fallbackUsed: false, durationMs: 5, errorKind: null });
  });
  const line = JSON.parse(lines[0]);
  assert.equal(line.attempts, 2);
  assert.equal(line.candidateIndex, 1);
  assert.equal(line.fallback, true);
});

test("concurrent turns keep separate probes", async () => {
  const lines: string[] = [];
  const t = createTurnTelemetry({ write: (l) => lines.push(l) });
  const mk = (tool: boolean) => t.run(() => runAssistantTurn(t.wrapPorts(ports({ tool, reply: "fine" })), ctx, input));
  await Promise.all([mk(true), mk(false), mk(true)]);
  const parsed = lines.map((l) => JSON.parse(l));
  assert.equal(parsed.length, 3);
  assert.equal(parsed.filter((l) => l.tools.length === 1).length, 2);
  assert.ok(parsed.every((l) => l.attempts === 1));
});

test("a throwing prior observer or write cannot break the turn bookkeeping", async () => {
  const p = ports();
  p.observer = { onTurn() { throw new Error("nope"); } };
  const { lines, err } = await turn(p);
  assert.equal(err, null);
  assert.equal(lines.length, 1);
});

test("percentile: nearest rank", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([7], 95), 7);
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(v, 50), 50);
  assert.equal(percentile(v, 95), 95);
  assert.equal(percentile(v, 100), 100);
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([10, 20], 95), 20);
});

test("metrics: counts, errors by kind, fallbacks, window of 200", () => {
  const m = createMetrics(200, () => new Date("2026-10-23T00:00:00Z"));
  const base = { evt: "assistant_turn", t: "x", provider: "p", model: "m", candidateIndex: 0, attempts: 1, tools: [], toolMs: 0, plan: "free", u: null } as const;
  m.record({ ...base, ok: true, fallback: false, errorKind: null, groundingFlags: 0, totalMs: 100 });
  m.record({ ...base, ok: false, fallback: true, errorKind: "rate_limit", groundingFlags: 2, totalMs: 300 });
  m.record({ ...base, ok: false, fallback: false, errorKind: "rate_limit", groundingFlags: 0, totalMs: 200 });
  let s = m.snapshot();
  assert.equal(s.turns, 3);
  assert.equal(s.errors, 2);
  assert.deepEqual(s.errorsByKind, { rate_limit: 2 });
  assert.equal(s.fallbacks, 1);
  assert.equal(s.groundingFlaggedTurns, 1);
  assert.equal(s.latencyMs.p50, 200);
  assert.equal(s.latencyMs.p95, 300);
  assert.equal(s.scope, "per-instance");
  for (let i = 0; i < 300; i += 1) m.record({ ...base, ok: true, fallback: false, errorKind: null, groundingFlags: 0, totalMs: 1000 + i });
  s = m.snapshot();
  assert.equal(s.turns, 303);
  assert.equal(s.latencyMs.samples, 200);
  assert.equal(s.latencyMs.p50, 1000 + 100 + 99); // window holds 1100..1299
});

test("admin endpoint: 401 without or with a wrong bearer or unset secret, 200 with the right one", () => {
  const m = createMetrics();
  assert.equal(assistantHealthResponse(null, "s3cret-value", m).status, 401);
  assert.equal(assistantHealthResponse("Bearer wrong", "s3cret-value", m).status, 401);
  assert.equal(assistantHealthResponse("Bearer undefined", undefined, m).status, 401);
  assert.equal(assistantHealthResponse("Bearer s3cret-value", "", m).status, 401);
  const ok = assistantHealthResponse("Bearer s3cret-value", "s3cret-value", m);
  assert.equal(ok.status, 200);
  if (ok.status === 200) {
    assert.equal(ok.body.turns, 0);
    assert.match(ok.body.note, /per server instance/);
  }
});
