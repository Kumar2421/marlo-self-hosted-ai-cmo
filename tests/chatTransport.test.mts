import test from "node:test";
import assert from "node:assert/strict";
import { streamChatMessage, type ChatRequest } from "../lib/query/chatTransport.ts";
import { describeChatFailure } from "../lib/domain/chat/chatSessionState.ts";
import { encodeSseEvent, type StreamEvent } from "../lib/domain/assistant/sse.ts";

const req: ChatRequest = { message: "hi", history: [], projectId: "p1" };
const enc = new TextEncoder();

function sseResponse(chunks: (string | Error)[], status = 200, contentType = "text/event-stream"): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= chunks.length) return c.close();
      const next = chunks[i++];
      if (next instanceof Error) c.error(next);
      else c.enqueue(enc.encode(next));
    },
  });
  return new Response(body, { status, headers: { "content-type": contentType } });
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
function harness(route: Route) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    return route(url, init);
  }) as unknown as typeof fetch;
  const events: StreamEvent[] = [];
  return { urls, fetchImpl, events, onEvent: (e: StreamEvent) => { events.push(e); } };
}

const status: StreamEvent = { type: "status", phase: "thinking", label: "Thinking..." };
const delta = (text: string): StreamEvent => ({ type: "delta", text });
const done: StreamEvent = { type: "done", toolsUsed: [], lookedAt: ["site audit"] };

test("stream: events arrive in order across awkward chunk boundaries", async () => {
  const wire = [status, delta("Hel"), delta("lo 😀"), done].map(encodeSseEvent).join("");
  const cut = [wire.slice(0, 10), wire.slice(10, 11), wire.slice(11, 70), wire.slice(70)];
  const h = harness(() => sseResponse(cut));
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.deepEqual(h.events, [status, delta("Hel"), delta("lo 😀"), done]);
  assert.deepEqual(h.urls, ["/api/chat/stream"]);
});

test("stream: in-stream error event is delivered once, no fallback", async () => {
  const err: StreamEvent = { type: "error", message: "Out of credits.", code: "402" };
  const h = harness(() => sseResponse([encodeSseEvent(status), encodeSseEvent(err)]));
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.deepEqual(h.events, [status, err]);
  assert.deepEqual(h.urls, ["/api/chat/stream"]);
});

test("fallback: fetch throws before any byte -> JSON endpoint answers", async () => {
  const h = harness((url) => {
    if (url === "/api/chat/stream") throw new TypeError("network");
    return json({ reply: "plain answer", lookedAt: ["leads"] });
  });
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.deepEqual(h.urls, ["/api/chat/stream", "/api/chat"]);
  assert.deepEqual(h.events, [delta("plain answer"), { type: "done", toolsUsed: [], lookedAt: ["leads"] }]);
});

test("fallback: stream endpoint 404/502 or wrong content type -> JSON endpoint", async () => {
  for (const make of [() => json({}, 404), () => json({}, 502), () => json({ reply: "x" }, 200)]) {
    let first = true;
    const h = harness((url) => (url === "/api/chat/stream" && first ? ((first = false), make()) : json({ reply: "via json" })));
    await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
    assert.deepEqual(h.urls, ["/api/chat/stream", "/api/chat"]);
    assert.equal((h.events[0] as { text: string }).text, "via json");
  }
});

test("fallback: stream dies before the first byte -> JSON endpoint", async () => {
  const h = harness((url) => (url === "/api/chat/stream" ? sseResponse([new Error("reset")]) : json({ reply: "recovered" })));
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.deepEqual(h.urls, ["/api/chat/stream", "/api/chat"]);
  assert.equal(h.events.at(-1)?.type, "done");
});

test("fallback: empty 200 stream (zero bytes) -> JSON endpoint", async () => {
  const h = harness((url) => (url === "/api/chat/stream" ? sseResponse([]) : json({ reply: "ok" })));
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.deepEqual(h.urls, ["/api/chat/stream", "/api/chat"]);
});

test("no fallback after the first byte: broken stream becomes an error event, JSON never called", async () => {
  const h = harness(() => sseResponse([encodeSseEvent(status), encodeSseEvent(delta("part")), new Error("reset")]));
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.deepEqual(h.urls, ["/api/chat/stream"]);
  assert.deepEqual(h.events.slice(0, 2), [status, delta("part")]);
  const last = h.events.at(-1) as Extract<StreamEvent, { type: "error" }>;
  assert.equal(last.type, "error");
  assert.equal(last.code, "stream_interrupted");
});

test("stream that ends without done/error is an interrupted error", async () => {
  const h = harness(() => sseResponse([encodeSseEvent(status)]));
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.equal((h.events.at(-1) as { code?: string }).code, "stream_interrupted");
});

test("a real 4xx from the stream route (bad body) is shown, not re-run as JSON", async () => {
  const h = harness(() => json({ error: "message is required" }, 400));
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.deepEqual(h.urls, ["/api/chat/stream"]);
  assert.deepEqual(h.events, [{ type: "error", message: "message is required" }]);
});

test("JSON fallback failure surfaces one friendly error", async () => {
  const h = harness((url) => {
    if (url === "/api/chat/stream") return json({}, 404);
    throw new TypeError("offline");
  });
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.equal(h.events.length, 1);
  assert.match((h.events[0] as { message: string }).message, /Couldn't reach the server/);
});

test("abort: delivers nothing more and does not fall back", async () => {
  const ac = new AbortController();
  const h = harness(() => sseResponse([encodeSseEvent(status), encodeSseEvent(delta("a")), new Error("AbortError")]));
  const events: StreamEvent[] = [];
  await streamChatMessage(req, (e) => { events.push(e); if (e.type === "delta") ac.abort(); }, ac.signal, h.fetchImpl);
  assert.deepEqual(h.urls, ["/api/chat/stream"]);
  assert.equal(events.at(-1)?.type, "delta");
});

test("abort before the request: fetch rejects, no fallback call", async () => {
  const ac = new AbortController();
  ac.abort();
  const h = harness(() => { throw new DOMException("aborted", "AbortError"); });
  await streamChatMessage(req, h.onEvent, ac.signal, h.fetchImpl);
  assert.deepEqual(h.urls, ["/api/chat/stream"]);
  assert.deepEqual(h.events, []);
});

test("chat_limit: in-stream error keeps code and fields, and maps to the same describeChatFailure path as JSON", async () => {
  const err: StreamEvent = { type: "error", message: "You have used your free chats for this month.", code: "chat_limit", used: 10, limit: 10, resetsAt: "2026-11-01T00:00:00.000Z", plan: "free" };
  const h = harness(() => sseResponse([encodeSseEvent(status), encodeSseEvent(err)]));
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  const got = h.events.at(-1) as Extract<StreamEvent, { type: "error" }>;
  assert.deepEqual(got, err);
  const viaStream = describeChatFailure({ error: got.message, code: got.code, limit: got.limit });
  assert.deepEqual(viaStream, { message: "You've used your 10 free chats this month. Plans unlock more.", limitReached: true });
});

test("chat_limit via the JSON fallback yields the identical error event", async () => {
  const body = { error: "You have used your free chats for this month.", code: "chat_limit", used: 10, limit: 10, resetsAt: "2026-11-01T00:00:00.000Z", plan: "free" };
  const h = harness((url) => (url === "/api/chat/stream" ? json({}, 404) : json(body, 402)));
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.deepEqual(h.events, [{ type: "error", message: body.error, code: "chat_limit", used: 10, limit: 10, resetsAt: body.resetsAt, plan: "free" }]);
});

test("request body no longer carries model or provider", async () => {
  let sent = "";
  const h = harness((_u, init) => { sent = String(init?.body); return sseResponse([encodeSseEvent(done)]); });
  await streamChatMessage(req, h.onEvent, undefined, h.fetchImpl);
  assert.deepEqual(Object.keys(JSON.parse(sent)).sort(), ["history", "message", "projectId"]);
});
