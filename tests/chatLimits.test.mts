import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_MAX_HISTORY_CHARS,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_MESSAGE_CHARS,
  trimChatHistory,
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

test("a new message at the cap passes; one over the cap is rejected with the documented message", () => {
  assert.equal(validateChatInput("x".repeat(CHAT_MAX_MESSAGE_CHARS), []).ok, true);
  const over = validateChatInput("x".repeat(CHAT_MAX_MESSAGE_CHARS + 1), []);
  assert.deepEqual(over, { ok: false, error: "Message too long (max 4000 characters)" });
});

test("an oversize new message is rejected even when history is fine", () => {
  const history = [{ role: "user", content: "a" }];
  assert.equal(validateChatInput("x".repeat(CHAT_MAX_MESSAGE_CHARS + 1), history).ok, false);
});

test("a long assistant reply in history is trimmed to its last 4000 characters and the request succeeds", () => {
  const reply = "A".repeat(6000) + "TAIL";
  const out = validateChatInput("next question", [
    { role: "user", content: "first" },
    { role: "assistant", content: reply },
  ]);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.history.length, 2);
  assert.equal(out.history[0].content, "first");
  assert.equal(out.history[1].role, "assistant");
  assert.equal(out.history[1].content.length, CHAT_MAX_MESSAGE_CHARS);
  assert.ok(out.history[1].content.endsWith("TAIL"));
});

test("history over the message count keeps the newest 30 entries in order", () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  const out = trimChatHistory(history);
  assert.equal(out.length, CHAT_MAX_HISTORY_MESSAGES);
  assert.equal(out[0].content, "m10");
  assert.equal(out[29].content, "m39");
  assert.deepEqual(out.map((e) => e.content), history.slice(10).map((e) => e.content));
});

test("history over the total character budget drops the oldest entries first", () => {
  const chunk = (tag: string) => tag + "y".repeat(CHAT_MAX_MESSAGE_CHARS - tag.length);
  const history = ["a", "b", "c", "d", "e", "f"].map((tag) => ({ role: "user", content: chunk(tag) }));
  const out = validateChatInput("hi", history);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(CHAT_MAX_HISTORY_CHARS, 20000);
  assert.equal(out.history.length, 5); // 5 x 4000 = 20000 exactly
  assert.deepEqual(out.history.map((e) => e.content[0]), ["b", "c", "d", "e", "f"]);
});

test("trimming stops at the first entry that does not fit, so the kept history is contiguous", () => {
  const big = (tag: string) => tag + "y".repeat(CHAT_MAX_MESSAGE_CHARS - 1);
  const history = [
    { role: "user", content: big("B") },
    { role: "assistant", content: big("C") },
    { role: "user", content: big("D") },
    { role: "assistant", content: big("E") },
    { role: "user", content: big("F") },
    { role: "assistant", content: big("G") },
    { role: "user", content: "new1" },
    { role: "assistant", content: "new2" },
  ];
  const out = trimChatHistory(history);
  // Newest first: new2 (4), new1 (8), G (4008), F (8008), E (12008), D (16008); C would reach 20008, so C and B are dropped.
  assert.deepEqual(out.map((e) => e.content[0]), ["D", "E", "F", "G", "n", "n"]);
  assert.equal(out.length, 6);
  assert.equal(out[0].content.length, CHAT_MAX_MESSAGE_CHARS);
  assert.equal(out[4].content, "new1");
  assert.equal(out[5].content, "new2");
});

test("malformed history entries are dropped instead of rejecting the turn", () => {
  const out = validateChatInput("hi", [{ role: "system", content: "x" }, { role: "user" }, null, { role: "user", content: "kept" }]);
  assert.deepEqual(out, { ok: true, history: [{ role: "user", content: "kept" }] });
});

test("history that is not a list is treated as empty", () => {
  assert.deepEqual(validateChatInput("hi", "nope"), { ok: true, history: [] });
  assert.deepEqual(validateChatInput("hi", { role: "user", content: "x" }), { ok: true, history: [] });
});
