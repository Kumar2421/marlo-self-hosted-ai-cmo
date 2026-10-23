import { test } from "node:test";
import * as assert from "node:assert";
import { runAssistantTurn, type AssistantPorts } from "../lib/domain/assistant/assistantService.ts";
import { AssistantError, type TurnContext } from "../lib/domain/assistant/assistantTypes.ts";
import { assistantHealthResponse } from "../lib/domain/assistant/healthEndpoint.ts";
import { SILENT_TURN_OPTIONS, buildTurnLogLine, createMetrics, createTurnTelemetry, hashUserId, percentile, type TurnProbe } from "../lib/domain/assistant/turnLog.ts";
import type { ChatPorts } from "../lib/domain/chat/tools.ts";

const EMAIL = "jane.doe@secretcorp.com";
const TOKEN = "sk-live-AbCdEf0123456789XyZ9876543210";
const MESSAGE = "my private question about Project Falcon revenue";
const USER = "user-uuid-1234-5678";
const THREAD = "11111111-2222-4333-8444-555555555555";
const STREAM_DELTA = "streamed private delta about Project Falcon";

const chatPorts = {
  getSearchSnapshot: async () => null, listFindings: async () => [], getFinding: async () => null, recommendationsFor: () => [],
  listActionsWithOutcomes: async () => [], getLeadSummary: async () => ({ total: 0, emailed: 0, replied: 0 }),
  getGeoStatus: async () => null, getAuditSummary: async () => null, listCompetitors: async () => [], now: () => new Date("2026-10-23T00:00:00Z"),
} as unknown as ChatPorts;

function ports(o: { fail?: boolean; reply?: string; tool?: boolean; failFirst?: boolean; fallback?: boolean; plan?: string; stream?: boolean } = {}): AssistantPorts {
  let n = 0;
  return {
    scope: { authenticate: async () => ({ userId: USER }), activeProjectId: async () => "p1" },
    llm: {
      supportsTools: () => true,
      getDriver: (providerId) => async (req) => {
        n += 1;
        if (o.fallback && providerId === "groq") throw Object.assign(new Error(`rate limited ${EMAIL}`), { status: 429 });
        if (o.stream) return { stream: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(STREAM_DELTA)); c.close(); } }) };
        if (o.fail || (o.failFirst && n === 1)) throw Object.assign(new Error(`boom ${EMAIL} ${TOKEN}`), { status: 429 });
        if (o.tool !== false) await req.tools?.find((t) => t.name === "get_audit_summary")?.execute({});
        return { text: o.reply ?? `Hello ${EMAIL}, you have 4242 clicks. ${TOKEN}` };
      },
    },
    credentials: {
      resolve: async () => (o.fallback ? { kind: "platform", loadApiKey: () => TOKEN } : { kind: "byok", apiKey: TOKEN, baseUrl: undefined }),
      preferredModel: async () => (o.fallback ? null : { providerId: "anthropic", model: "claude-x" }),
      platformAvailable: (id) => Boolean(o.fallback) && (id === "groq" || id === "mistral"),
    },
    credits: { canAfford: async () => ({ ok: true }), charge: async () => ({ ok: true }) },
    prompts: { build: async () => "SYS" },
    data: { create: () => chatPorts },
    entitlements: { entitlement: async () => ({ plan: (o.plan ?? "free") as never, enforced: false }), countPlatformChatMessages: async () => 0 },
  };
}
const ctx: TurnContext = { mode: "platform", userId: null, activeProjectId: null };
const input = { message: MESSAGE, history: [], projectId: "p1", threadId: THREAD };

async function turn(p: AssistantPorts, plan?: string) {
  const lines: string[] = [];
  const t = createTurnTelemetry({ write: (l) => lines.push(l), salt: "pepper", now: () => new Date("2026-10-23T10:00:00Z") });
  let err: unknown = null;
  try { await t.run(() => runAssistantTurn(t.wrapPorts(p), ctx, input, SILENT_TURN_OPTIONS), { plan }); } catch (e) { err = e; }
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
  assert.equal(line.plan, "free", "plan comes from the turn's entitlement lookup");
  assert.ok(line.groundingFlags >= 1, "4242 is invented");
  for (const secret of [EMAIL, TOKEN, MESSAGE, USER, THREAD, STREAM_DELTA, "Falcon", "secretcorp", "4242", "SYS"]) {
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
    p.observer!.onTurn({ modelUsed: { providerId: "anthropic", model: "m2" }, toolsUsed: [], fallbackUsed: true, durationMs: 5, errorKind: null, candidateIndex: 1, attempts: 2, attemptFailures: ["rate_limit"] });
  });
  const line = JSON.parse(lines[0]);
  assert.equal(line.attempts, 2);
  assert.equal(line.candidateIndex, 1);
  assert.equal(line.fallback, true);
});

test("concurrent turns keep separate probes", async () => {
  const lines: string[] = [];
  const t = createTurnTelemetry({ write: (l) => lines.push(l) });
  const mk = (tool: boolean) => t.run(() => runAssistantTurn(t.wrapPorts(ports({ tool, reply: "fine" })), ctx, input, SILENT_TURN_OPTIONS));
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
  const base = { evt: "assistant_turn" as const, t: "x", provider: "p", model: "m", candidateIndex: 0, attempts: 1, tools: [] as string[], toolMs: 0, plan: "free", u: null };
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

test("exactly ONE log line per turn (route options): ok, fallback and failed turns; the legacy text line is silenced", async () => {
  const legacy: string[] = [];
  const spy = console.log;
  console.log = (...a: unknown[]) => { legacy.push(a.join(" ")); };
  try {
    for (const [name, p, kind] of [["ok", ports(), null], ["fallback", ports({ fallback: true }), null], ["failed", ports({ fail: true }), "rate_limit"]] as const) {
      const lines: string[] = [];
      const t = createTurnTelemetry({ write: (l) => lines.push(l) });
      await t.run(() => runAssistantTurn(t.wrapPorts(p), ctx, input, SILENT_TURN_OPTIONS)).catch(() => {});
      assert.equal(lines.length, 1, `${name}: structured lines`);
      assert.equal(t.metrics.snapshot().turns, 1, `${name}: counted once`);
      const line = JSON.parse(lines[0]);
      assert.equal(line.errorKind, kind, name);
      if (name === "fallback") { assert.equal(line.fallback, true); assert.equal(line.candidateIndex, 1); assert.equal(line.attempts, 2); assert.equal(line.provider, "mistral"); assert.equal(t.metrics.snapshot().fallbacks, 1); }
      if (name === "failed") assert.ok(line.ok === false);
      assert.ok(!lines[0].includes(EMAIL), name);
    }
  } finally { console.log = spy; }
  assert.deepEqual(legacy.filter((l) => l.includes("[assistant]")), [], "legacy text line must not be printed");
});

test("streaming turn: counted once, plan logged, stream delta and thread id never reach the line", async () => {
  const { runAssistantTurnStream } = await import("../lib/domain/assistant/assistantStream.ts");
  const lines: string[] = [];
  const events: unknown[] = [];
  const t = createTurnTelemetry({ write: (l) => lines.push(l), salt: "pepper" });
  const sp = ports({ stream: true, plan: "pro", tool: false });
  sp.data = { create: () => null }; // no project data: the plain call path is the one that really streams
  await t.run(() => runAssistantTurnStream(t.wrapPorts(sp), ctx, input, (e) => events.push(e), { chunkDelayMs: 0, ...SILENT_TURN_OPTIONS }));
  assert.equal(lines.length, 1);
  assert.equal(t.metrics.snapshot().turns, 1);
  assert.ok(JSON.stringify(events).includes("streamed private delta"), "the client did receive the text");
  const line = JSON.parse(lines[0]);
  assert.equal(line.plan, "pro");
  for (const secret of [STREAM_DELTA, "streamed private", THREAD, MESSAGE, EMAIL, TOKEN, USER]) assert.ok(!lines[0].includes(secret), `leaked ${secret}`);
});

test("self-host turns log plan 'selfhost'", async () => {
  const lines: string[] = [];
  const t = createTurnTelemetry({ write: (l) => lines.push(l) });
  const p = ports(); delete p.entitlements;
  await t.run(() => runAssistantTurn(t.wrapPorts(p), { ...ctx, mode: "selfhost" }, input, SILENT_TURN_OPTIONS));
  assert.equal(JSON.parse(lines[0]).plan, "selfhost");
});
