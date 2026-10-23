import test from "node:test";
import assert from "node:assert/strict";
import {
  chatSessionReducer as reduce,
  initialChatSessionState as init,
  historyForRequest,
  lastFailedUserText,
  retryRequest,
  type ChatSessionAction,
  type ChatSessionState,
} from "../lib/domain/chat/chatSessionState.ts";

const u = (text: string) => ({ role: "user" as const, text });
const a = (text: string, extra = {}) => ({ role: "assistant" as const, text, ...extra });

const cases: { name: string; state: ChatSessionState; action: ChatSessionAction; want: ChatSessionState }[] = [
  { name: "send appends user and sets pending", state: init, action: { type: "send", text: "hi" }, want: { messages: [u("hi")], pending: true } },
  { name: "reply appends assistant and clears pending", state: { messages: [u("hi")], pending: true }, action: { type: "reply", text: "yo", lookedAt: ["seo"] }, want: { messages: [u("hi"), a("yo", { lookedAt: ["seo"] })], pending: false } },
  { name: "reply without lookedAt", state: { messages: [u("hi")], pending: true }, action: { type: "reply", text: "yo" }, want: { messages: [u("hi"), a("yo", { lookedAt: undefined })], pending: false } },
  { name: "fail appends error bubble", state: { messages: [u("hi")], pending: true }, action: { type: "fail", message: "⚠ no" }, want: { messages: [u("hi"), a("⚠ no", { error: true })], pending: false } },
  { name: "reset clears everything", state: { messages: [u("hi"), a("yo")], pending: true }, action: { type: "reset" }, want: init },
];
for (const c of cases) test(`reducer: ${c.name}`, () => assert.deepEqual(reduce(c.state, c.action), c.want));

test("reducer does not mutate its input", () => {
  const s: ChatSessionState = { messages: [u("hi")], pending: false };
  reduce(s, { type: "send", text: "x" });
  assert.deepEqual(s, { messages: [u("hi")], pending: false });
});

test("historyForRequest drops error bubbles", () => {
  assert.deepEqual(historyForRequest([u("a"), a("⚠", { error: true }), u("b"), a("c")]), [
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: "c" },
  ]);
});

test("lastFailedUserText", () => {
  assert.equal(lastFailedUserText([]), null);
  assert.equal(lastFailedUserText([u("a"), a("ok")]), null);
  assert.equal(lastFailedUserText([u("a"), a("ok"), u("b"), a("⚠", { error: true })]), "b");
  assert.equal(lastFailedUserText([a("⚠", { error: true })]), null);
});

function run(actions: ChatSessionAction[], from: ChatSessionState = init): ChatSessionState {
  return actions.reduce(reduce, from);
}
const stream = (text: string): ChatSessionAction[] => [{ type: "send", text }, { type: "stream_start" }];

test("streaming: message grows while pending, status clears when text starts, lookedAt on done", () => {
  let s = run(stream("how is my site?"));
  assert.deepEqual(s, { messages: [u("how is my site?"), { role: "assistant", text: "", streaming: true }], pending: true });
  s = run([{ type: "status", label: "Checking your latest audit..." }], s);
  assert.equal(s.messages[1].status, "Checking your latest audit...");
  s = run([{ type: "delta", text: "Your " }, { type: "delta", text: "site" }], s);
  assert.equal(s.messages[1].text, "Your site");
  assert.equal(s.messages[1].status, undefined);
  assert.equal(s.messages[1].lookedAt, undefined, "Looked at only appears on done");
  assert.equal(s.pending, true);
  s = run([{ type: "done", lookedAt: ["site audit"] }], s);
  assert.deepEqual(s, { messages: [u("how is my site?"), a("Your site", { lookedAt: ["site audit"] })], pending: false });
  assert.equal(s.messages[1].streaming, undefined);
});

test("streaming: stream_start is idempotent", () => {
  const s = run(stream("q"));
  assert.equal(reduce(s, { type: "stream_start" }), s);
});

test("streaming: events with no streaming message are ignored", () => {
  const s: ChatSessionState = { messages: [u("q"), a("old")], pending: false };
  for (const act of [{ type: "status", label: "x" }, { type: "delta", text: "x" }, { type: "done" }] as ChatSessionAction[]) {
    assert.equal(reduce(s, act), s);
  }
});

test("streaming: fail mid-stream replaces the half-written message with an error bubble", () => {
  const s = run([...stream("q"), { type: "delta", text: "partial" }, { type: "fail", message: "⚠ lost" }]);
  assert.deepEqual(s, { messages: [u("q"), a("⚠ lost", { error: true })], pending: false });
  assert.deepEqual(historyForRequest(s.messages), [{ role: "user", content: "q" }]);
});

test("streaming: fail before the first byte (no stream message yet) still appends the error bubble", () => {
  const s = run([{ type: "send", text: "q" }, { type: "fail", message: "⚠ x" }]);
  assert.deepEqual(s.messages, [u("q"), a("⚠ x", { error: true })]);
});

test("streaming: abort (New chat) resets; late events then do nothing", () => {
  let s = run([...stream("q"), { type: "delta", text: "abc" }, { type: "reset" }]);
  assert.deepEqual(s, init);
  s = run([{ type: "delta", text: "late" }, { type: "done" }, { type: "status", label: "x" }], s);
  assert.deepEqual(s, init);
});

test("retry: drops the error bubble, keeps ONE user message, goes pending", () => {
  const failed = run([...stream("q"), { type: "fail", message: "⚠" }]);
  const s = run([{ type: "retry" }], failed);
  assert.deepEqual(s, { messages: [u("q")], pending: true });
});

test("retry: no-op when nothing failed or a request is in flight", () => {
  const ok: ChatSessionState = { messages: [u("q"), a("fine")], pending: false };
  assert.equal(reduce(ok, { type: "retry" }), ok);
  const busy: ChatSessionState = { messages: [u("q"), a("⚠", { error: true })], pending: true };
  assert.equal(reduce(busy, { type: "retry" }), busy);
});

test("retryRequest: failed text plus the history BEFORE it (no duplicated user turn)", () => {
  const msgs = [u("a"), a("b"), u("c"), a("⚠", { error: true })];
  assert.deepEqual(retryRequest(msgs), { text: "c", history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] });
  assert.equal(retryRequest([u("a"), a("b")]), null);
});

test("retry resends once: two quick taps produce one request", () => {
  let s = run([...stream("q"), { type: "fail", message: "⚠" }]);
  let sends = 0;
  const tap = () => {
    const plan = retryRequest(s.messages);
    if (!plan || s.pending) return;
    s = reduce(s, { type: "retry" });
    sends += 1;
  };
  tap(); tap();
  assert.equal(sends, 1);
  assert.equal(s.messages.filter((m) => m.role === "user").length, 1);
});
