import { test } from "node:test";
import assert from "node:assert/strict";
import { runAssistantTurnStream, chunkText } from "../lib/domain/assistant/assistantStream.ts";
import type { ChatEntitlement } from "../lib/domain/assistant/chatEntitlements.ts";
import type { AssistantPorts } from "../lib/domain/assistant/assistantService.ts";
import type { TurnContext } from "../lib/domain/assistant/assistantTypes.ts";
import type { DriverLike } from "../lib/domain/chat/toolLoop.ts";
import type { ChatPorts } from "../lib/domain/chat/tools.ts";
import { createSseDecoder, encodeSseEvent, type StreamEvent } from "../lib/domain/assistant/sse.ts";

const chatPorts = {
  getAuditSummary: async () => null, listFindings: async () => [], getSearchSnapshot: async () => null,
  listActionsWithOutcomes: async () => [], getLeadSummary: async () => ({ total: 0, emailed: 0, replied: 0, truncated: false }),
  getGeoStatus: async () => null, listCompetitors: async () => [], now: () => new Date("2026-01-01T00:00:00Z"),
} as unknown as ChatPorts;

const ctx: TurnContext = { mode: "platform", userId: null, activeProjectId: null };
const input = { message: "hi", history: [], projectId: "p1" };

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } });
}

function setup(driver: DriverLike, o: { tools?: boolean; withData?: boolean; cred?: "byok" | "platform"; ent?: ChatEntitlement; used?: number; driverFor?: (id: string) => DriverLike } = {}) {
  const calls: string[] = [];
  const ports: AssistantPorts = {
    scope: { authenticate: async () => ({ userId: "u" }), activeProjectId: async () => "p1" },
    llm: { getDriver: (id) => (o.driverFor ? o.driverFor(id) : driver), supportsTools: () => !!o.tools },
    credentials: {
      resolve: async () => { calls.push("cred"); return o.cred === "platform" ? { kind: "platform", loadApiKey: () => "pk" } : { kind: "byok", apiKey: "k", baseUrl: undefined }; },
      preferredModel: async () => (o.cred === "platform" ? null : { providerId: "openai", model: "m" }),
      platformAvailable: (id) => o.cred === "platform" && (id === "groq" || id === "mistral"),
    },
    credits: {
      canAfford: async () => ({ ok: true }),
      charge: async () => { calls.push("charge"); return { ok: true }; },
    },
    entitlements: o.ent ? {
      entitlement: async () => o.ent as ChatEntitlement,
      countPlatformChatMessages: async () => o.used ?? 0,
    } : undefined,
    prompts: { build: async () => "SYS" },
    data: { create: () => (o.withData ? chatPorts : null) },
  };
  const events: StreamEvent[] = [];
  return { ports, events, calls, emit: (e: StreamEvent) => { events.push(e); } };
}
const noDelay = { chunkDelayMs: 0 };
const text = (evs: StreamEvent[]) => evs.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");

test("tool path: status events, then chunked deltas, then done", async () => {
  const driver: DriverLike = async (req) => {
    assert.equal(req.stream, undefined, "tool path is not token-streamed");
    await req.tools!.find((t) => t.name === "get_search_summary")!.execute({});
    await req.tools!.find((t) => t.name === "get_audit_summary")!.execute({});
    return { text: "Your audit has not run yet, so I cannot say what is wrong with the site." };
  };
  const s = setup(driver, { tools: true, withData: true });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  const types = s.events.map((e) => e.type);
  assert.deepEqual(s.events.slice(0, 3).map((e) => e.type === "status" && e.phase), ["thinking", "tool", "tool"]);
  assert.equal((s.events[2] as { label: string }).label, "Checking your latest audit...");
  assert.equal(types.at(-1), "done");
  assert.ok(types.filter((t) => t === "delta").length > 1, "typed out in several chunks");
  assert.equal(text(s.events), "Your audit has not run yet, so I cannot say what is wrong with the site.");
  const done = s.events.at(-1) as Extract<StreamEvent, { type: "done" }>;
  assert.deepEqual(done.toolsUsed, ["get_search_summary", "get_audit_summary"]);
  assert.ok(done.lookedAt.includes("site audit"));
});

test("no-tools path with a streaming driver forwards real deltas as they arrive", async () => {
  const driver: DriverLike = async (req) => {
    assert.equal(req.stream, true);
    return { stream: streamOf("Hel", "lo ", "wörld") };
  };
  const s = setup(driver);
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  assert.deepEqual(s.events.filter((e) => e.type === "delta"), [
    { type: "delta", text: "Hel" }, { type: "delta", text: "lo " }, { type: "delta", text: "wörld" },
  ]);
  assert.equal(s.events.at(-1)?.type, "done");
});

test("context path (tools unsupported, project data present) streams for real too", async () => {
  const driver: DriverLike = async (req) => {
    assert.equal(req.stream, true);
    assert.ok(req.system?.includes("Overview of stored project data"));
    return { stream: streamOf("ok") };
  };
  const s = setup(driver, { tools: false, withData: true });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  assert.equal(text(s.events), "ok");
});

test("driver that ignores stream and returns text is chunked", async () => {
  const s = setup(async () => ({ text: "one two three four five six seven eight nine ten eleven" }));
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  assert.equal(text(s.events), "one two three four five six seven eight nine ten eleven");
  assert.equal(s.events.at(-1)?.type, "done");
});

test("error before any text: one error event, stream ends, no done", async () => {
  const s = setup(async () => { throw new Error("401 invalid api key"); });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  const last = s.events.at(-1) as Extract<StreamEvent, { type: "error" }>;
  assert.equal(last.type, "error");
  assert.equal(last.code, "502");
  assert.match(last.message, /API key was rejected/);
  assert.ok(!s.events.some((e) => e.type === "done"));
});

test("success on a platform key charges exactly once, after the reply", async () => {
  const s = setup(async () => ({ stream: streamOf("hi") }), { cred: "platform" });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  assert.equal(s.calls.filter((c) => c === "charge").length, 1);
  assert.equal(s.events.at(-1)?.type, "done");
});

test("abort before a successful reply charges NOTHING (even if the driver finishes anyway)", async () => {
  const ac = new AbortController();
  // The driver ignores the signal and returns a good reply AFTER the client left.
  const s = setup(async () => { ac.abort(); return { text: "late answer" }; }, { cred: "platform" });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, { ...noDelay, signal: ac.signal });
  assert.ok(!s.calls.includes("charge"), "no charge");
  assert.ok(!s.events.some((e) => e.type === "done" || e.type === "delta"));
});

test("provider error before any text charges nothing", async () => {
  const s = setup(async () => { throw new Error("401 invalid api key"); }, { cred: "platform" });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  assert.ok(!s.calls.includes("charge"));
});

test("fallback still works before the first delta, but is blocked once text has streamed", async () => {
  const rate = () => new Error("429 rate limit");
  // Before any text: first model fails, second answers.
  const seen: string[] = [];
  const a = setup(async () => ({ text: "x" }), { cred: "platform", driverFor: (id) => async () => { seen.push(id); if (id === "groq") throw rate(); return { text: "from mistral" }; } });
  await runAssistantTurnStream(a.ports, ctx, input, a.emit, noDelay);
  assert.deepEqual(seen, ["groq", "mistral"]);
  assert.equal(text(a.events), "from mistral");
  // After text streamed: the failure ends the turn, no second model, no duplicated text.
  const seen2: string[] = [];
  const b = setup(async () => ({ text: "x" }), { cred: "platform", driverFor: (id) => async () => {
    seen2.push(id);
    let pulls = 0;
    return { stream: new ReadableStream<Uint8Array>({ pull(c) { if (pulls++ === 0) c.enqueue(new TextEncoder().encode("partial")); else c.error(rate()); } }) };
  } });
  await runAssistantTurnStream(b.ports, ctx, input, b.emit, noDelay);
  assert.deepEqual(seen2, ["groq"]);
  assert.equal(text(b.events), "partial");
  assert.equal(b.events.at(-1)?.type, "error");
  assert.ok(!b.calls.includes("charge"));
});

test("chat_limit denial is an in-stream error event with code and body fields, nothing charged", async () => {
  const s = setup(async () => ({ text: "never" }), { cred: "platform", ent: { plan: "free", enforced: true }, used: 10 });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  const last = s.events.at(-1) as Extract<StreamEvent, { type: "error" }>;
  assert.equal(last.type, "error");
  assert.equal(last.code, "chat_limit");
  assert.equal(last.used, 10);
  assert.equal(last.limit, 10);
  assert.equal(last.plan, "free");
  assert.ok(String(last.resetsAt).endsWith("-01T00:00:00.000Z"));
  assert.ok(!s.calls.includes("charge"));
  // And it survives the wire.
  const d = createSseDecoder();
  assert.deepEqual(d.push(encodeSseEvent(last)), [last]);
});

test("pipeline errors keep their status as the error code (409 scope), before any charge", async () => {
  const s = setup(async () => ({ text: "x" }), { cred: "platform" });
  s.ports.scope.activeProjectId = async () => "other";
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  assert.equal((s.events.at(-1) as { code?: string }).code, "409");
  assert.ok(!s.calls.includes("charge"));
});

test("error mid-stream after some text becomes an error event", async () => {
  let pulls = 0;
  const failing = new ReadableStream<Uint8Array>({
    pull(c) { if (pulls++ === 0) c.enqueue(new TextEncoder().encode("partial ")); else c.error(new Error("connection reset")); },
  });
  const s = setup(async () => ({ stream: failing }));
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  assert.equal(text(s.events), "partial ");
  assert.equal(s.events.at(-1)!.type, "error");
  assert.ok(!s.events.some((e) => e.type === "done"));
});

test("client abort before the turn starts: nothing charged, nothing emitted", async () => {
  const ac = new AbortController();
  ac.abort();
  let driverCalled = false;
  const s = setup(async () => { driverCalled = true; return { text: "x" }; }, { cred: "platform" });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, { ...noDelay, signal: ac.signal });
  assert.equal(driverCalled, false);
  assert.ok(!s.calls.includes("charge"));
  assert.deepEqual(s.events, []);
});

test("client abort while typing out stops the chunks and sends no done", async () => {
  const ac = new AbortController();
  const s = setup(async () => ({ text: "a ".repeat(100) }));
  let n = 0;
  const emit = (e: StreamEvent) => { s.events.push(e); if (e.type === "delta" && ++n === 2) ac.abort(); };
  await runAssistantTurnStream(s.ports, ctx, input, emit, { ...noDelay, signal: ac.signal });
  assert.equal(n, 2);
  assert.ok(!s.events.some((e) => e.type === "done" || e.type === "error"));
});

test("client abort mid-stream: signal reaches the driver, run ends quietly", async () => {
  const ac = new AbortController();
  let seen: AbortSignal | undefined;
  const driver: DriverLike = async (req) => {
    seen = req.signal;
    let pulls = 0;
    return { stream: new ReadableStream({ pull(c) {
      if (pulls++ === 0) { c.enqueue(new TextEncoder().encode("a")); return; }
      ac.abort();
      c.error(new Error("aborted"));
    } }) };
  };
  const s = setup(driver);
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, { ...noDelay, signal: ac.signal });
  assert.equal(seen, ac.signal);
  assert.ok(!s.events.some((e) => e.type === "error" || e.type === "done"));
});

test("a sink that throws (closed connection) does not throw out of the runner", async () => {
  const s = setup(async () => ({ text: "hello there" }));
  await runAssistantTurnStream(s.ports, ctx, input, () => { throw new Error("closed"); }, noDelay);
});

test("empty reply is an error, never a silent done (and never charged)", async () => {
  const s = setup(async () => ({ text: "" }), { cred: "platform" });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  assert.equal(s.events.at(-1)?.type, "error");
  assert.ok(!s.events.some((e) => e.type === "done"));
  assert.ok(!s.calls.includes("charge"));
});

test("SSE round trip: emitted events survive encode, arbitrary chunking, decode", async () => {
  const s = setup(async () => ({ text: "Zażółć gęślą jaźń 😀 and more words to chunk up here" }));
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, noDelay);
  const wire = new TextEncoder().encode(s.events.map(encodeSseEvent).join(""));
  const d = createSseDecoder();
  const got: StreamEvent[] = [];
  for (let i = 0; i < wire.length; i += 7) got.push(...d.push(wire.slice(i, i + 7)));
  assert.deepEqual(got, s.events);
});

test("chunkText keeps text intact", () => {
  for (const t of ["", "a", "a b  c\n\nd e", "  lead and trail  ", "x".repeat(100)]) assert.equal(chunkText(t).join(""), t);
});
