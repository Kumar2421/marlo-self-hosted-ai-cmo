import { test } from "node:test";
import * as assert from "node:assert";
import { checkChatProjectScope, CHAT_PROJECT_MISMATCH } from "../lib/domain/chat/projectScope.ts";
import { providerSupportsTools, limitedDataNotice, LIMITED_DATA_NOTICE } from "../lib/llm/capabilities.ts";

test("project scope: same project passes", () => {
  assert.deepEqual(checkChatProjectScope("p1", "p1"), { ok: true });
});

test("project scope: history claiming another project is rejected (audit D11)", () => {
  assert.deepEqual(checkChatProjectScope("projectA", "projectB"), { ok: false, error: CHAT_PROJECT_MISMATCH });
  assert.equal(checkChatProjectScope("projectA", null).ok, false);
});

test("project scope: legacy clients without a project id keep working; junk ids do not", () => {
  assert.equal(checkChatProjectScope(undefined, "p1").ok, true);
  assert.equal(checkChatProjectScope(null, null).ok, true);
  assert.equal(checkChatProjectScope("", "p1").ok, false);
  assert.equal(checkChatProjectScope(42, "p1").ok, false);
});

test("capability map: tool loop only for OpenAI-compatible providers", () => {
  for (const id of ["openai", "groq", "mistral", "lmstudio", "ollama", "custom"]) assert.equal(providerSupportsTools(id), true, id);
  for (const id of ["anthropic", "google", "xai", "openrouter", "unknown"]) assert.equal(providerSupportsTools(id), false, id);
});

test("limited-data notice appears for anthropic/google only", () => {
  assert.equal(limitedDataNotice("anthropic"), LIMITED_DATA_NOTICE);
  assert.equal(limitedDataNotice("google"), "Limited data access with this model");
  assert.equal(limitedDataNotice("openai"), null);
  assert.equal(limitedDataNotice(null), null);
});
