import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_MAX_HISTORY_CHARS,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_MESSAGE_CHARS,
  validateChatInput,
} from "../lib/domain/chat/chatLimits.ts";

test("a normal message with short history passes and keeps only role and content", () => {
  const out = validateChatInput("hi", [{ role: "user", content: "a", extra: 1 }, { role: "assistant", content: "b" }]);
  assert.deepEqual(out, { ok: true, history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] });
});

test("missing history is an empty history", () => {
  assert.deepEqual(validateChatInput("hi", undefined), { ok: true, history: [] });
  assert.deepEqual(validateChatInput("hi", null), { ok: true, history: [] });
});

test("empty or non-string message is rejected", () => {
  assert.equal(validateChatInput("   ", []).ok, false);
  assert.equal(validateChatInput(42, []).ok, false);
});

test("message at the cap passes and one over the cap is rejected with a clear error", () => {
  assert.equal(validateChatInput("x".repeat(CHAT_MAX_MESSAGE_CHARS), []).ok, true);
  const over = validateChatInput("x".repeat(CHAT_MAX_MESSAGE_CHARS + 1), []);
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.error, /too long/);
});

test("history count is capped", () => {
  const atCap = Array.from({ length: CHAT_MAX_HISTORY_MESSAGES }, () => ({ role: "user", content: "a" }));
  assert.equal(validateChatInput("hi", atCap).ok, true);
  const over = validateChatInput("hi", [...atCap, { role: "user", content: "a" }]);
  assert.equal(over.ok, false);
});

test("total history characters are capped", () => {
  const chunk = "y".repeat(CHAT_MAX_MESSAGE_CHARS);
  const fiveFull = Array.from({ length: 5 }, () => ({ role: "user", content: chunk }));
  assert.equal(CHAT_MAX_HISTORY_CHARS, 20000);
  assert.equal(validateChatInput("hi", fiveFull).ok, true); // exactly 20000 characters
  const over = validateChatInput("hi", [...fiveFull, { role: "user", content: "z" }]);
  assert.equal(over.ok, false);
});

test("a history entry with a bad role, missing content or oversize content is rejected", () => {
  assert.equal(validateChatInput("hi", [{ role: "system", content: "x" }]).ok, false);
  assert.equal(validateChatInput("hi", [{ role: "user" }]).ok, false);
  assert.equal(validateChatInput("hi", [null]).ok, false);
  assert.equal(validateChatInput("hi", [{ role: "user", content: "x".repeat(CHAT_MAX_MESSAGE_CHARS + 1) }]).ok, false);
});

test("history that is not a list is rejected", () => {
  assert.equal(validateChatInput("hi", "nope").ok, false);
  assert.equal(validateChatInput("hi", { role: "user", content: "x" }).ok, false);
});
