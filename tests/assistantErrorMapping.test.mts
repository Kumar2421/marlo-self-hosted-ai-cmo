import { test } from "node:test";
import * as assert from "node:assert";
import { classifyProviderError, friendlyProviderError } from "../lib/domain/assistant/errorMapping.ts";

const withStatus = (status: number, message = "x") => Object.assign(new Error(message), { status });

const table: Array<[string, unknown, string, boolean]> = [
  ["status 401", withStatus(401), "auth", false],
  ["status 403", withStatus(403), "auth", false],
  ["status 404", withStatus(404), "model_unavailable", false],
  ["status 408", withStatus(408), "timeout", true],
  ["status 429", withStatus(429), "rate_limit", true],
  ["status 500", withStatus(500), "server", true],
  ["status 503", withStatus(503), "server", true],
  ["status 400", withStatus(400), "bad_request", false],
  ["status wins over text", withStatus(429, "authentication failed"), "rate_limit", true],
  ["msg auth", new Error("Authentication error: invalid x-api-key"), "auth", false],
  ["msg invalid api key", new Error("Incorrect invalid API key provided"), "auth", false],
  ["msg rate limit", new Error("Rate limit reached for requests"), "rate_limit", true],
  ["msg 429", new Error("Request failed with 429"), "rate_limit", true],
  ["msg model not found", new Error("The model `gpt-9` does not exist"), "model_unavailable", false],
  ["msg timeout", new Error("Request timed out."), "timeout", true],
  ["msg ETIMEDOUT", new Error("connect ETIMEDOUT 1.2.3.4:443"), "timeout", true],
  ["msg ECONNRESET", new Error("read ECONNRESET"), "network", true],
  ["msg fetch failed", new Error("fetch failed"), "network", true],
  ["msg overloaded", new Error("Overloaded"), "server", true],
  ["msg 502", new Error("502 Bad Gateway"), "server", true],
  ["msg bad request", new Error("400 invalid request body"), "bad_request", false],
  ["unknown error", new Error("kaboom"), "unknown", false],
  ["non-error value", "weird", "unknown", false],
  ["null", null, "unknown", false],
];

for (const [name, err, kind, retryable] of table) {
  test(`classifyProviderError: ${name}`, () => {
    assert.deepEqual(classifyProviderError(err), { kind, retryable });
  });
}

test("friendlyProviderError keeps its four messages", () => {
  assert.equal(friendlyProviderError("openai", new Error("401")), "openai: API key was rejected. Check it in Settings → LLM Providers.");
  assert.equal(friendlyProviderError("openai", new Error("rate limit")), "openai: rate limited — wait a moment and try again.");
  assert.equal(friendlyProviderError("openai", new Error("model x not found")), "openai: that model isn't available on this account.");
  assert.equal(friendlyProviderError("openai", "?"), "openai request failed. Try again in a moment.");
});
