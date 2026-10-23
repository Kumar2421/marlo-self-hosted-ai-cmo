import test from "node:test";
import assert from "node:assert/strict";
import { createSseDecoder, encodeSseEvent, SSE_KEEPALIVE, parseStreamEvent, type StreamEvent } from "../lib/domain/assistant/sse.ts";

const events: StreamEvent[] = [
  { type: "status", phase: "thinking", label: "Thinking..." },
  { type: "status", phase: "tool", tool: "get_audit_summary", label: "Checking your latest audit..." },
  { type: "delta", text: "Héllo 世界 😀\nline two \"quoted\" \  " },
  { type: "done", toolsUsed: ["get_audit_summary"], lookedAt: ["site audit"] },
  { type: "error", message: "nope", code: "502" },
];
const wire = events.map(encodeSseEvent).join("");

test("sse: round trip in one chunk", () => {
  const d = createSseDecoder();
  assert.deepEqual(d.push(wire), events);
  assert.deepEqual(d.end(), []);
});

test("sse: split at every possible character boundary", () => {
  for (let i = 0; i <= wire.length; i++) {
    const d = createSseDecoder();
    const got = [...d.push(wire.slice(0, i)), ...d.push(wire.slice(i)), ...d.end()];
    assert.deepEqual(got, events, `split at ${i}`);
  }
});

test("sse: byte chunks split inside a multi-byte character", () => {
  const bytes = new TextEncoder().encode(wire);
  for (let i = 0; i <= bytes.length; i++) {
    const d = createSseDecoder();
    const got = [...d.push(bytes.slice(0, i)), ...d.push(bytes.slice(i)), ...d.end()];
    assert.deepEqual(got, events, `byte split at ${i}`);
  }
});

test("sse: one byte at a time", () => {
  const d = createSseDecoder();
  const got: StreamEvent[] = [];
  for (const b of new TextEncoder().encode(wire)) got.push(...d.push(new Uint8Array([b])));
  assert.deepEqual(got, events);
});

test("sse: keepalive comments and CRLF framing are tolerated", () => {
  const d = createSseDecoder();
  const crlf = encodeSseEvent(events[2]).replace(/\n/g, "\r\n");
  const got = [...d.push(SSE_KEEPALIVE), ...d.push(crlf.slice(0, crlf.length - 1)), ...d.push(crlf.slice(-1)), ...d.push(SSE_KEEPALIVE)];
  assert.deepEqual(got, [events[2]]);
});

test("sse: malformed frames are skipped, later frames still decode", () => {
  const d = createSseDecoder();
  const bad = [
    "data: {not json}\n\n",
    "event: delta\n\n",
    'data: {"type":"delta"}\n\n',
    'data: {"type":"mystery","x":1}\n\n',
    'data: {"type":"status","phase":"weird","label":"x"}\n\n',
    "data: 42\n\n",
    "garbage with no colon\n\n",
  ].join("");
  assert.deepEqual(d.push(bad + encodeSseEvent(events[0])), [events[0]]);
});

test("sse: end() flushes a complete final frame without its blank line", () => {
  const d = createSseDecoder();
  assert.deepEqual(d.push('data: {"type":"delta","text":"x"}\n'), []);
  assert.deepEqual(d.end(), [{ type: "delta", text: "x" }]);
});

test("sse: end() drops a truncated frame", () => {
  const d = createSseDecoder();
  d.push('data: {"type":"delta","te');
  assert.deepEqual(d.end(), []);
});

test("sse: multi-line data joins with newline (spec)", () => {
  const d = createSseDecoder();
  assert.deepEqual(d.push('data: {"type":"delta",\ndata: "text":"a"}\n\n'), [{ type: "delta", text: "a" }]);
});

test("parseStreamEvent: coerces list fields and rejects non-objects", () => {
  assert.deepEqual(parseStreamEvent({ type: "done", toolsUsed: ["a", 1], lookedAt: "x" }), { type: "done", toolsUsed: ["a"], lookedAt: [] });
  assert.equal(parseStreamEvent(null), null);
  assert.equal(parseStreamEvent("x"), null);
});
