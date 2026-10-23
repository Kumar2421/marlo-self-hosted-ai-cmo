import test from "node:test";
import assert from "node:assert/strict";
import {
  chatSessionReducer as reduce,
  initialChatSessionState as init,
  historyForRequest,
  lastFailedUserText,
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
