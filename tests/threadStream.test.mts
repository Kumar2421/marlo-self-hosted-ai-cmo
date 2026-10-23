import test from "node:test";
import assert from "node:assert/strict";
import { runAssistantTurnStream } from "../lib/domain/assistant/assistantStream.ts";
import { runAssistantTurn, type AssistantPorts } from "../lib/domain/assistant/assistantService.ts";
import type { TurnContext } from "../lib/domain/assistant/assistantTypes.ts";
import { memoryThreadStore } from "../lib/domain/assistant/threadStore.ts";
import type { DriverLike } from "../lib/domain/chat/toolLoop.ts";
import type { StreamEvent } from "../lib/domain/assistant/sse.ts";
import { parseStreamEvent } from "../lib/domain/assistant/sse.ts";

const ctx: TurnContext = { mode: "platform", userId: null, activeProjectId: null };
const scope = { userId: "u", projectId: "p1" };

function setup(driver: DriverLike, o: { platform?: boolean; used?: number } = {}) {
  const threads = memoryThreadStore();
  const ports: AssistantPorts = {
    scope: { authenticate: async () => ({ userId: "u" }), activeProjectId: async () => "p1" },
    llm: { getDriver: () => driver, supportsTools: () => false },
    credentials: {
      resolve: async () => (o.platform ? { kind: "platform", loadApiKey: () => "pk" } : { kind: "byok", apiKey: "k", baseUrl: undefined }),
      preferredModel: async () => (o.platform ? null : { providerId: "openai", model: "m" }),
      platformAvailable: (id) => !!o.platform && (id === "groq" || id === "mistral"),
    },
    credits: { canAfford: async () => ({ ok: true }), charge: async () => ({ ok: true }) },
    entitlements: o.platform
      ? { entitlement: async () => ({ plan: "free", enforced: true }), countPlatformChatMessages: async () => o.used ?? 0 }
      : undefined,
    prompts: { build: async () => "SYS" },
    data: { create: () => null },
    threads,
  };
  const events: StreamEvent[] = [];
  return { ports, threads, events, emit: (e: StreamEvent) => { events.push(e); } };
}
const input = { message: "hi there", history: [], projectId: "p1" };
const ok: DriverLike = async () => ({ text: "hello back" });

test("stream: a successful turn is persisted exactly once and done carries the threadId", async () => {
  const s = setup(ok);
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, { chunkDelayMs: 0 });
  const done = s.events.find((e) => e.type === "done") as { threadId?: string } | undefined;
  assert.ok(done?.threadId);
  const list = await s.threads.listThreads(scope);
  assert.equal(list.length, 1);
  const got = await s.threads.getThread(scope, list[0].id);
  assert.deepEqual(got?.messages.map((m) => m.content), ["hi there", "hello back"]);
  assert.equal(done?.threadId, list[0].id);
  // the wire format keeps the id
  assert.equal((parseStreamEvent(JSON.parse(JSON.stringify(done))) as { threadId?: string }).threadId, done?.threadId);
});

test("stream: a follow-up with the threadId continues the same thread (still one thread, four messages)", async () => {
  const s = setup(ok);
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, { chunkDelayMs: 0 });
  const id = (s.events.find((e) => e.type === "done") as { threadId: string }).threadId;
  await runAssistantTurnStream(s.ports, ctx, { ...input, message: "again", threadId: id }, s.emit, { chunkDelayMs: 0 });
  assert.equal((await s.threads.listThreads(scope)).length, 1);
  assert.equal((await s.threads.getThread(scope, id))?.messages.length, 4);
});

test("stream: a provider error persists nothing and creates no thread", async () => {
  const s = setup(async () => { throw new Error("provider down"); });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, { chunkDelayMs: 0 });
  assert.ok(s.events.some((e) => e.type === "error"));
  assert.deepEqual(await s.threads.listThreads(scope), []);
});

test("stream: an aborted client persists nothing and creates no thread", async () => {
  const ctrl = new AbortController();
  const s = setup(async () => { ctrl.abort(); return { text: "late answer" }; });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, { chunkDelayMs: 0, signal: ctrl.signal });
  assert.equal(s.events.some((e) => e.type === "done"), false);
  assert.deepEqual(await s.threads.listThreads(scope), []);
});

test("stream: a chat_limit denial persists nothing, creates no thread and sends no message to the model", async () => {
  let called = 0;
  const s = setup(async () => { called += 1; return { text: "x" }; }, { platform: true, used: 10_000 });
  await runAssistantTurnStream(s.ports, ctx, input, s.emit, { chunkDelayMs: 0 });
  const err = s.events.find((e) => e.type === "error") as { code?: string } | undefined;
  assert.equal(err?.code, "chat_limit");
  assert.equal(called, 0);
  assert.deepEqual(await s.threads.listThreads(scope), []);
});

test("JSON path: a chat_limit denial also persists nothing", async () => {
  const s = setup(ok, { platform: true, used: 10_000 });
  await assert.rejects(() => runAssistantTurn(s.ports, ctx, input));
  assert.deepEqual(await s.threads.listThreads(scope), []);
});

test("stream: an unknown thread id is an in-stream error and nothing is stored", async () => {
  const s = setup(ok);
  await runAssistantTurnStream(s.ports, ctx, { ...input, threadId: "11111111-1111-1111-1111-111111111111" }, s.emit, { chunkDelayMs: 0 });
  assert.equal((s.events.find((e) => e.type === "error") as { code?: string }).code, "404");
  assert.deepEqual(await s.threads.listThreads(scope), []);
});
