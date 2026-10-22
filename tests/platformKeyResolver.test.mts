import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Fake values only; set before the module reads process.env at import time.
process.env.GROQ_API_KEY = "test-platform-groq";
process.env.MISTRAL_API_KEY = "test-platform-mistral";
const { resolveLlmCredential, validateHostedProviderSave, safeBaseUrl } = await import("../lib/llm/platformKeys.ts");

test("platform key is used without any base url, even if the user saved one", () => {
  const c = resolveLlmCredential({ providerId: "groq", byokKey: "", byokBaseUrl: "https://attacker.example/v1" });
  assert.equal(c.source, "platform");
  assert.equal(c.apiKey, "test-platform-groq");
  assert.equal(c.baseUrl, undefined);
});

test("whitespace-only or missing byok key falls to platform with no base url", () => {
  for (const byokKey of ["  ", undefined, null]) {
    const c = resolveLlmCredential({ providerId: "mistral", byokKey, byokBaseUrl: "https://attacker.example/v1" });
    assert.equal(c.source, "platform");
    assert.equal(c.baseUrl, undefined);
  }
});

test("byok key keeps the user's base url", () => {
  const c = resolveLlmCredential({ providerId: "groq", byokKey: "user-key", byokBaseUrl: "https://proxy.example/v1" });
  assert.deepEqual(c, { source: "byok", apiKey: "user-key", baseUrl: "https://proxy.example/v1" });
});

test("no byok and no platform key yields nothing", () => {
  const c = resolveLlmCredential({ providerId: "openai", byokKey: "", byokBaseUrl: "https://x.example/v1" });
  assert.deepEqual(c, { source: "none", apiKey: "", baseUrl: undefined });
});

test("safeBaseUrl drops base url when the key is the platform key", () => {
  assert.equal(safeBaseUrl("groq", "test-platform-groq", "https://attacker.example"), undefined);
  assert.equal(safeBaseUrl("groq", "user-key", "https://proxy.example"), "https://proxy.example");
  assert.equal(safeBaseUrl("openai", "anything", "https://proxy.example"), "https://proxy.example");
});

test("hosted save: baseUrl without apiKey is rejected for platform providers", () => {
  for (const providerId of ["groq", "mistral"]) {
    assert.match(validateHostedProviderSave({ providerId, apiKey: "", baseUrl: "https://a.example/v1" }) ?? "", /requires your own API key/);
    assert.match(validateHostedProviderSave({ providerId, apiKey: "   ", baseUrl: "https://a.example/v1" }) ?? "", /requires/);
  }
});

test("hosted save: allowed combinations", () => {
  assert.equal(validateHostedProviderSave({ providerId: "groq", apiKey: "k", baseUrl: "https://a.example/v1" }), null);
  assert.equal(validateHostedProviderSave({ providerId: "groq", apiKey: "k", baseUrl: null }), null);
  assert.equal(validateHostedProviderSave({ providerId: "openai", apiKey: "", baseUrl: "https://a.example/v1" }), null);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(p);
  }
  return out;
}

test("PLATFORM_PROVIDER_KEYS[ is only indexed inside lib/llm/platformKeys.ts", () => {
  const offenders = [...walk("app"), ...walk("lib")]
    .filter((f) => f.split("\\").join("/") !== "lib/llm/platformKeys.ts")
    .filter((f) => /PLATFORM_PROVIDER_KEYS\s*(\[|\.)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});
