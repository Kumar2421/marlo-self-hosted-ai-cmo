import { test } from "node:test";
import * as assert from "node:assert";
import { runAssistantTurn, type AssistantPorts, type TurnEvent } from "../lib/domain/assistant/assistantService.ts";
import { AssistantError, type TurnContext } from "../lib/domain/assistant/assistantTypes.ts";
import { resolveModelPlan, shouldFallback } from "../lib/domain/assistant/modelSelection.ts";
import { buildChatSystemPrompt, buildChatSystemPromptSupabase, STYLE_INSTRUCTION } from "../lib/domain/assistant/promptBuilder.ts";
import { createDataPorts } from "../lib/domain/assistant/toolRegistry.ts";
import { CHAT_PROJECT_MISMATCH } from "../lib/domain/chat/projectScope.ts";
import type { ChatPorts } from "../lib/domain/chat/tools.ts";

type Overrides = {
  authed?: boolean; activeId?: string | null; drivers?: string[];
  cred?: Awaited<ReturnType<AssistantPorts["credentials"]["resolve"]>>;
  charge?: "ok" | "insufficient";
  driverText?: string | (() => never);
  withData?: boolean;
};

const fakeChatPorts = {
  getSearchSnapshot: async () => null,
  listFindings: async () => [],
  getFinding: async () => null,
  recommendationsFor: () => [],
  listActionsWithOutcomes: async () => [],
  getLeadSummary: async () => ({ total: 0, emailed: 0, replied: 0, truncated: false }),
  getGeoStatus: async () => null,
  getAuditSummary: async () => null,
  listCompetitors: async () => [],
  now: () => new Date("2026-01-01T00:00:00Z"),
} as unknown as ChatPorts;

function fakes(o: Overrides = {}) {
  const calls: string[] = [];
  const events: TurnEvent[] = [];
  const drivers = o.drivers ?? ["anthropic", "openai"];
  const driverCalls: Array<{ apiKey: string; model: string; baseUrl?: string; system?: string; messages: unknown[] }> = [];
  const ports: AssistantPorts = {
    scope: {
      authenticate: async () => { calls.push("auth"); return o.authed === false ? null : { userId: "u1" }; },
      activeProjectId: async () => { calls.push("active"); return o.activeId === undefined ? "p1" : o.activeId; },
    },
    llm: {
      getDriver: (id) => drivers.includes(id)
        ? async (req) => {
          driverCalls.push(req as never);
          if (typeof o.driverText === "function") return o.driverText();
          return { text: o.driverText ?? "hello" };
        }
        : null,
      supportsTools: () => false,
    },
    credentials: { resolve: async () => { calls.push("cred"); return o.cred ?? { kind: "byok", apiKey: "k", baseUrl: "http://b" }; } },
    credits: { chargeBeforeAnswer: async () => { calls.push("charge"); return o.charge === "insufficient" ? { ok: false, reason: "insufficient" } : { ok: true }; } },
    prompts: { build: async () => { calls.push("prompt"); return "SYS"; } },
    data: { create: () => { calls.push("data"); return o.withData ? fakeChatPorts : null; } },
    observer: { onTurn: (e) => events.push(e) },
  };
  return { ports, calls, events, driverCalls };
}

const ctx: TurnContext = { mode: "platform", userId: null, activeProjectId: null };
const good = { message: "hi", history: [], projectId: "p1", requestedProvider: "anthropic", requestedModel: "m1" };

async function status(p: Promise<unknown>): Promise<{ status: number; error: string } | "ok"> {
  try { await p; return "ok"; } catch (e) {
    if (e instanceof AssistantError) return { status: e.status, error: e.userMessage };
    throw e;
  }
}

test("400: empty / invalid / too-long message", async () => {
  for (const message of [undefined, "", "   ", 5]) {
    const { ports } = fakes();
    assert.deepEqual(await status(runAssistantTurn(ports, ctx, { ...good, message })), { status: 400, error: "message is required" });
  }
  const { ports } = fakes();
  assert.deepEqual(await status(runAssistantTurn(ports, ctx, { ...good, message: "x".repeat(4001) })), { status: 400, error: "Message too long (max 4000 characters)" });
});

test("422: no model or provider; 501: unknown driver; both before auth", async () => {
  const f = fakes();
  const msg = "No model selected. Connect a provider in Settings → LLM Providers.";
  assert.deepEqual(await status(runAssistantTurn(f.ports, ctx, { ...good, requestedModel: undefined })), { status: 422, error: msg });
  assert.deepEqual(await status(runAssistantTurn(f.ports, ctx, { ...good, requestedProvider: undefined })), { status: 422, error: msg });
  assert.deepEqual(await status(runAssistantTurn(f.ports, ctx, { ...good, requestedProvider: "xai" })), {
    status: 501, error: "xai isn't wired to a real model yet — only Anthropic, OpenAI, and Google are live so far.",
  });
  assert.deepEqual(f.calls, []);
});

test("401 not authenticated, nothing charged", async () => {
  const f = fakes({ authed: false });
  assert.deepEqual(await status(runAssistantTurn(f.ports, ctx, good)), { status: 401, error: "Not authenticated" });
  assert.deepEqual(f.calls, ["auth"]);
});

test("409 project scope mismatch, before credentials or charge", async () => {
  const f = fakes({ activeId: "other" });
  assert.deepEqual(await status(runAssistantTurn(f.ports, ctx, good)), { status: 409, error: CHAT_PROJECT_MISMATCH });
  assert.deepEqual(f.calls, ["auth", "active"]);
});

test("422 provider not connected (no key, no platform key)", async () => {
  const f = fakes({ cred: { kind: "missing" } });
  assert.deepEqual(await status(runAssistantTurn(f.ports, ctx, good)), {
    status: 422, error: "anthropic isn't connected yet. Connect it in Settings → LLM Providers.",
  });
  assert.ok(!f.calls.includes("charge"));
});

test("402 out of credits on platform key; BYOK is never charged", async () => {
  const f = fakes({ cred: { kind: "platform", loadApiKey: () => "pk" }, charge: "insufficient" });
  assert.deepEqual(await status(runAssistantTurn(f.ports, ctx, good)), { status: 402, error: "Out of credits. Upgrade or connect your own key." });
  assert.deepEqual(f.calls, ["auth", "active", "cred", "charge"]);
  const byok = fakes();
  await runAssistantTurn(byok.ports, ctx, good);
  assert.ok(!byok.calls.includes("charge"));
});

test("502 friendly provider messages", async () => {
  const cases: Array<[string, string]> = [
    ["401 invalid api key", "anthropic: API key was rejected. Check it in Settings → LLM Providers."],
    ["429 rate limit", "anthropic: rate limited — wait a moment and try again."],
    ["model foo not found", "anthropic: that model isn't available on this account."],
    ["boom", "anthropic request failed. Try again in a moment."],
  ];
  for (const [raw, friendly] of cases) {
    const f = fakes({ driverText: () => { throw new Error(raw); } });
    assert.deepEqual(await status(runAssistantTurn(f.ports, ctx, good)), { status: 502, error: friendly });
  }
});

test("success without data ports: plain driver call, charge happens before the answer on platform key", async () => {
  const f = fakes({ cred: { kind: "platform", loadApiKey: () => "pk" }, activeId: null });
  const out = await runAssistantTurn(f.ports, ctx, { ...good, projectId: undefined, history: [{ role: "assistant", content: "a" }] });
  assert.deepEqual(out, { reply: "hello", toolsUsed: [], lookedAt: [] });
  assert.deepEqual(f.calls, ["auth", "active", "cred", "charge", "prompt", "data"]);
  assert.equal(f.driverCalls[0].apiKey, "pk");
  assert.equal(f.driverCalls[0].baseUrl, undefined);
  assert.equal(f.driverCalls[0].system, "SYS");
  assert.deepEqual(f.driverCalls[0].messages, [{ role: "assistant", content: "a" }, { role: "user", content: "hi" }]);
});

test("success with data ports goes through the tool loop (no tools offered when provider lacks support)", async () => {
  const f = fakes({ withData: true });
  const out = await runAssistantTurn(f.ports, ctx, good);
  assert.equal(out.reply, "hello");
  assert.deepEqual(out.toolsUsed, []);
  assert.equal(f.driverCalls[0].baseUrl, "http://b");
});

test("observer gets metadata only, and a throwing observer cannot break a turn", async () => {
  const f = fakes();
  await runAssistantTurn(f.ports, ctx, good);
  assert.equal(f.events.length, 1);
  assert.deepEqual(f.events[0].modelUsed, { providerId: "anthropic", model: "m1" });
  assert.equal(f.events[0].fallbackUsed, false);
  assert.equal(f.events[0].errorKind, null);
  assert.deepEqual(Object.keys(f.events[0]).sort(), ["durationMs", "errorKind", "fallbackUsed", "modelUsed", "toolsUsed"]);

  const bad = fakes();
  bad.ports.observer = { onTurn: () => { throw new Error("x"); } };
  assert.equal((await runAssistantTurn(bad.ports, ctx, good)).reply, "hello");

  const failing = fakes({ driverText: () => { throw new Error("429"); } });
  await status(runAssistantTurn(failing.ports, ctx, good));
  assert.equal(failing.events[0].errorKind, "rate_limit");
});

test("model plan: one client-sent candidate; shouldFallback is false", () => {
  const plan = resolveModelPlan(ctx, good, { hasDriver: () => true });
  assert.deepEqual(plan, [{ providerId: "anthropic", model: "m1", credentialSource: "auto" }]);
  assert.equal(resolveModelPlan({ ...ctx, mode: "selfhost" }, good, { hasDriver: () => true })[0].credentialSource, "selfhost");
  assert.equal(shouldFallback(new Error("anything")), false);
});

test("prompt builders: style only without project; project and traffic blocks with one", async () => {
  assert.equal(buildChatSystemPrompt(null, { projectBlock: () => "B", trafficBlock: () => "T" }), STYLE_INSTRUCTION);
  assert.equal(buildChatSystemPrompt("p", { projectBlock: () => "B", trafficBlock: () => "T" }), `${STYLE_INSTRUCTION}\n\nB\n\nReal traffic/ranking data:\nT`);
  assert.match(buildChatSystemPrompt("p", { projectBlock: () => "B", trafficBlock: () => null }), /No real Traffic data cached yet/);
  assert.equal(await buildChatSystemPromptSupabase(null, { projectBlock: async () => "B" }), STYLE_INSTRUCTION);
  assert.equal(await buildChatSystemPromptSupabase("p", { projectBlock: async () => "B" }), `${STYLE_INSTRUCTION}\n\nB`);
});

test("createDataPorts: null without project, otherwise the matching backend", () => {
  const platform = { tag: "platform" } as unknown as ChatPorts;
  const selfHost = { tag: "self" } as unknown as ChatPorts;
  const backends = { platform: () => platform, selfHost: () => selfHost };
  assert.equal(createDataPorts({ mode: "platform", userId: "u", activeProjectId: null }, backends), null);
  assert.equal(createDataPorts({ mode: "platform", userId: "u", activeProjectId: "p" }, backends), platform);
  assert.equal(createDataPorts({ mode: "selfhost", userId: null, activeProjectId: "p" }, backends), selfHost);
});
