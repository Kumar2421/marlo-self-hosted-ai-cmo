import { test } from "node:test";
import * as assert from "node:assert";
import { runAssistantTurn, type AssistantPorts, type TurnEvent } from "../lib/domain/assistant/assistantService.ts";
import { AssistantError, type TurnContext } from "../lib/domain/assistant/assistantTypes.ts";
import { attemptBudgetMs, NO_MODEL_MESSAGE, resolveModelPlan } from "../lib/domain/assistant/modelSelection.ts";
import { pickPreferredModel } from "../lib/domain/assistant/credentialResolver.ts";
import { PLATFORM_DEFAULT_MODELS } from "../lib/llm/platformKeys.ts";
import { buildChatSystemPrompt, buildChatSystemPromptSupabase, STYLE_INSTRUCTION } from "../lib/domain/assistant/promptBuilder.ts";
import { createDataPorts } from "../lib/domain/assistant/toolRegistry.ts";
import { CHAT_PROJECT_MISMATCH } from "../lib/domain/chat/projectScope.ts";
import type { ChatPorts } from "../lib/domain/chat/tools.ts";

type Behavior = (req: { apiKey: string; model: string }) => Promise<{ text?: string }>;
type Overrides = {
  authed?: boolean; activeId?: string | null; drivers?: string[];
  /** Saved preferred model with a connected key; null = none. Default anthropic/m1. */
  preferred?: { providerId: string; model: string } | null;
  /** Providers with an operator key. Default none. */
  platform?: string[];
  cred?: Awaited<ReturnType<AssistantPorts["credentials"]["resolve"]>>;
  affordable?: boolean;
  chargeThrows?: boolean;
  driverText?: string | (() => never);
  behave?: Record<string, Behavior>;
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
  const charges: string[] = [];
  const drivers = o.drivers ?? ["anthropic", "openai", "groq", "mistral"];
  const preferred = o.preferred === undefined ? { providerId: "anthropic", model: "m1" } : o.preferred;
  const platform = o.platform ?? [];
  const driverCalls: Array<{ providerId: string; apiKey: string; model: string; baseUrl?: string; system?: string; messages: unknown[] }> = [];
  const ports: AssistantPorts = {
    scope: {
      authenticate: async () => { calls.push("auth"); return o.authed === false ? null : { userId: "u1" }; },
      activeProjectId: async () => { calls.push("active"); return o.activeId === undefined ? "p1" : o.activeId; },
    },
    llm: {
      getDriver: (id) => drivers.includes(id)
        ? async (req) => {
          driverCalls.push({ ...(req as object), providerId: id } as never);
          const b = o.behave?.[id];
          if (b) return b(req);
          if (typeof o.driverText === "function") return o.driverText();
          return { text: o.driverText ?? "hello" };
        }
        : null,
      supportsTools: () => false,
    },
    credentials: {
      resolve: async (_c, id) => {
        calls.push("cred");
        if (o.cred) return o.cred;
        if (preferred && id === preferred.providerId) return { kind: "byok", apiKey: "k", baseUrl: "http://b" };
        if (platform.includes(id)) return { kind: "platform", loadApiKey: () => `pk-${id}` };
        return { kind: "missing" };
      },
      preferredModel: async () => preferred,
      platformAvailable: (id) => platform.includes(id),
    },
    credits: {
      canAfford: async () => { calls.push("afford"); return o.affordable === false ? { ok: false, reason: "insufficient" } : { ok: true }; },
      charge: async (_c, model) => {
        calls.push("charge");
        if (o.chargeThrows) throw new Error("db down");
        charges.push(model);
        return { ok: true };
      },
    },
    prompts: { build: async () => { calls.push("prompt"); return "SYS"; } },
    data: { create: () => { calls.push("data"); return o.withData ? fakeChatPorts : null; } },
    observer: { onTurn: (e) => events.push(e) },
  };
  return { ports, calls, events, driverCalls, charges };
}

const ctx: TurnContext = { mode: "platform", userId: null, activeProjectId: null };
const good = { message: "hi", history: [], projectId: "p1" };
const quiet = { log: () => {} };
const run = (ports: AssistantPorts, input: object = good, c: TurnContext = ctx, opts: object = quiet) =>
  runAssistantTurn(ports, c, input as never, opts);
const fail = (msg: string, status?: number): Behavior => async () => { throw Object.assign(new Error(msg), status ? { status } : {}); };
const ok = (text = "fallback answer"): Behavior => async () => ({ text });
const PLATFORM: Overrides = { preferred: null, platform: ["groq", "mistral"] };

async function status(p: Promise<unknown>): Promise<{ status: number; error: string } | "ok"> {
  try { await p; return "ok"; } catch (e) {
    if (e instanceof AssistantError) return { status: e.status, error: e.userMessage };
    throw e;
  }
}

test("400: empty / invalid / too-long message", async () => {
  for (const message of [undefined, "", "   ", 5]) {
    const { ports } = fakes();
    assert.deepEqual(await status(run(ports, { ...good, message })), { status: 400, error: "message is required" });
  }
  const { ports } = fakes();
  assert.deepEqual(await status(run(ports, { ...good, message: "x".repeat(4001) })), { status: 400, error: "Message too long (max 4000 characters)" });
});

test("422 no candidates: nothing connected and no platform key (after auth now, since the plan needs the user)", async () => {
  const f = fakes({ preferred: null, platform: [] });
  assert.deepEqual(await status(run(f.ports)), { status: 422, error: NO_MODEL_MESSAGE });
  assert.equal(NO_MODEL_MESSAGE, "AI isn't available right now. Connect a provider in Settings > LLM Providers.");
  assert.deepEqual(f.calls, ["auth", "active"]);
  // a preferred provider without a driver is skipped too
  const noDriver = fakes({ preferred: { providerId: "xai", model: "x" }, platform: [] });
  assert.equal((await status(run(noDriver.ports)) as { status: number }).status, 422);
});

test("401 not authenticated, nothing charged", async () => {
  const f = fakes({ authed: false });
  assert.deepEqual(await status(run(f.ports)), { status: 401, error: "Not authenticated" });
  assert.deepEqual(f.calls, ["auth"]);
});

test("409 project scope mismatch, before credentials or charge", async () => {
  const f = fakes({ activeId: "other" });
  assert.deepEqual(await status(run(f.ports)), { status: 409, error: CHAT_PROJECT_MISMATCH });
  assert.deepEqual(f.calls, ["auth", "active"]);
});

test("a key that vanished between plan and attempt: candidate skipped, 422 when none left", async () => {
  const f = fakes({ cred: { kind: "missing" } });
  assert.deepEqual(await status(run(f.ports)), { status: 422, error: NO_MODEL_MESSAGE });
  assert.ok(!f.calls.includes("charge"));
  assert.equal(f.events[0].attempts, 0);
});

test("402 out of credits on platform key: no fallback, nothing charged; BYOK is never charged", async () => {
  const f = fakes({ ...PLATFORM, affordable: false });
  assert.deepEqual(await status(run(f.ports)), { status: 402, error: "Out of credits. Upgrade or connect your own key." });
  assert.deepEqual(f.calls, ["auth", "active", "cred", "afford"]);
  assert.deepEqual(f.charges, []);
  const byok = fakes();
  await run(byok.ports);
  assert.ok(!byok.calls.includes("charge") && !byok.calls.includes("afford"));
});

test("502 friendly provider messages (single candidate: surfaced as before)", async () => {
  const cases: Array<[string, string]> = [
    ["401 invalid api key", "anthropic: API key was rejected. Check it in Settings → LLM Providers."],
    ["429 rate limit", "anthropic: rate limited — wait a moment and try again."],
    ["model foo not found", "anthropic: that model isn't available on this account."],
    ["boom", "anthropic request failed. Try again in a moment."],
  ];
  for (const [raw, friendly] of cases) {
    const f = fakes({ driverText: () => { throw new Error(raw); } });
    assert.deepEqual(await status(run(f.ports)), { status: 502, error: friendly });
  }
});

test("success without data ports: plain driver call; platform credit charged AFTER the answer", async () => {
  const f = fakes({ ...PLATFORM, activeId: null });
  const out = await run(f.ports, { ...good, projectId: undefined, history: [{ role: "assistant", content: "a" }] });
  assert.deepEqual(out, { reply: "hello", toolsUsed: [], lookedAt: [] });
  assert.deepEqual(f.calls, ["auth", "active", "cred", "afford", "prompt", "data", "charge"]);
  assert.deepEqual(f.charges, [PLATFORM_DEFAULT_MODELS.groq]);
  assert.equal(f.driverCalls[0].providerId, "groq");
  assert.equal(f.driverCalls[0].apiKey, "pk-groq");
  assert.equal(f.driverCalls[0].baseUrl, undefined);
  assert.equal(f.driverCalls[0].system, "SYS");
  assert.deepEqual(f.driverCalls[0].messages, [{ role: "assistant", content: "a" }, { role: "user", content: "hi" }]);
});

test("success with data ports goes through the tool loop (no tools offered when provider lacks support)", async () => {
  const f = fakes({ withData: true });
  const out = await run(f.ports);
  assert.equal(out.reply, "hello");
  assert.deepEqual(out.toolsUsed, []);
  assert.equal(f.driverCalls[0].baseUrl, "http://b");
});

test("observer gets metadata only, and a throwing observer cannot break a turn", async () => {
  const f = fakes();
  await run(f.ports);
  assert.equal(f.events.length, 1);
  assert.deepEqual(f.events[0].modelUsed, { providerId: "anthropic", model: "m1" });
  assert.equal(f.events[0].fallbackUsed, false);
  assert.equal(f.events[0].errorKind, null);
  assert.equal(f.events[0].candidateIndex, 0);
  assert.equal(f.events[0].attempts, 1);
  assert.deepEqual(f.events[0].attemptFailures, []);
  assert.deepEqual(Object.keys(f.events[0]).sort(), ["attemptFailures", "attempts", "candidateIndex", "durationMs", "errorKind", "fallbackUsed", "modelUsed", "toolsUsed"]);
  assert.ok(!JSON.stringify(f.events[0]).includes("hello"), "no reply content in events");

  const bad = fakes();
  bad.ports.observer = { onTurn: () => { throw new Error("x"); } };
  assert.equal((await run(bad.ports)).reply, "hello");

  const failing = fakes({ driverText: () => { throw new Error("429"); } });
  await status(run(failing.ports));
  assert.equal(failing.events[0].errorKind, "rate_limit");
  assert.deepEqual(failing.events[0].attemptFailures, ["rate_limit"]);
});

// ---- model policy: plan ordering ----

const plan = (o: Overrides, c: TurnContext = ctx) => {
  const f = fakes(o);
  return resolveModelPlan(c, {
    hasDriver: (id) => f.ports.llm.getDriver(id) !== null,
    preferred: () => f.ports.credentials.preferredModel(c),
    platformAvailable: (id) => f.ports.credentials.platformAvailable(id),
    platformDefaults: { primary: { providerId: "groq", model: "G" }, secondary: { providerId: "mistral", model: "M" } },
  });
};

test("plan: BYOK preferred first, then platform default, then secondary", async () => {
  const p = await plan({ preferred: { providerId: "anthropic", model: "m1" }, platform: ["groq", "mistral"] });
  assert.deepEqual(p.map((c) => [c.providerId, c.model, c.role]), [["anthropic", "m1", "preferred"], ["groq", "G", "default"], ["mistral", "M", "secondary"]]);
});

test("plan: without BYOK it is the two platform models; missing platform key is skipped", async () => {
  assert.deepEqual((await plan({ preferred: null, platform: ["groq", "mistral"] })).map((c) => c.providerId), ["groq", "mistral"]);
  assert.deepEqual((await plan({ preferred: null, platform: ["mistral"] })).map((c) => c.providerId), ["mistral"]);
});

test("plan: providers are deduped (BYOK groq does not add the platform groq again)", async () => {
  const p = await plan({ preferred: { providerId: "groq", model: "mine" }, platform: ["groq", "mistral"] });
  assert.deepEqual(p.map((c) => [c.providerId, c.model]), [["groq", "mine"], ["mistral", "M"]]);
});

test("plan: self-host is the preferred model only (no platform keys); pure helpers", async () => {
  const sh: TurnContext = { ...ctx, mode: "selfhost" };
  const p = await plan({ preferred: { providerId: "openai", model: "o" }, platform: ["groq", "mistral"] }, sh);
  assert.deepEqual(p, [{ providerId: "openai", model: "o", credentialSource: "selfhost", role: "preferred" }]);
  const defs = [{ id: "openai", models: ["o"] }, { id: "groq", models: ["g"] }];
  assert.deepEqual(pickPreferredModel("o", ["openai"], defs), { providerId: "openai", model: "o" });
  assert.equal(pickPreferredModel("o", ["groq"], defs), null, "owner provider disconnected -> stale primary ignored");
  assert.equal(pickPreferredModel(null, ["openai"], defs), null);
  assert.deepEqual(pickPreferredModel("custom-x", ["ollama"], defs), { providerId: "ollama", model: "custom-x" });
  assert.equal(pickPreferredModel("custom-x", ["a", "b"], defs), null);
});

// ---- fallback policy ----

test("fallback happens for rate_limit, server, timeout, network, model_unavailable and an empty reply", async () => {
  const failures: Array<[string, Behavior, string]> = [
    ["429", fail("slow down", 429), "rate_limit"],
    ["500", fail("boom", 500), "server"],
    ["408", fail("x", 408), "timeout"],
    ["network", fail("fetch failed"), "network"],
    ["404", fail("model gone", 404), "model_unavailable"],
    ["empty", async () => ({ text: "   " }), "empty"],
    ["no text", async () => ({}), "empty"],
  ];
  for (const [label, behave, kind] of failures) {
    const f = fakes({ ...PLATFORM, behave: { groq: behave, mistral: ok() } });
    const out = await run(f.ports);
    assert.equal(out.reply, "fallback answer", label);
    assert.deepEqual(f.driverCalls.map((c) => c.providerId), ["groq", "mistral"], label);
    assert.equal(f.events[0].fallbackUsed, true, label);
    assert.equal(f.events[0].candidateIndex, 1, label);
    assert.deepEqual(f.events[0].attemptFailures, [kind], label);
    assert.deepEqual(f.events[0].modelUsed, { providerId: "mistral", model: PLATFORM_DEFAULT_MODELS.mistral }, label);
  }
});

test("NO fallback on auth (surfaced), bad_request, unknown, out-of-credits", async () => {
  for (const [raw, st, expected] of [
    ["invalid api key", 401, "anthropic: API key was rejected. Check it in Settings → LLM Providers."],
    ["bad payload", 400, "anthropic request failed. Try again in a moment."],
    ["weird", undefined, "anthropic request failed. Try again in a moment."],
  ] as const) {
    const f = fakes({ platform: ["groq", "mistral"], behave: { anthropic: fail(raw, st), groq: ok(), mistral: ok() } });
    assert.deepEqual(await status(run(f.ports)), { status: 502, error: expected }, raw);
    assert.deepEqual(f.driverCalls.map((c) => c.providerId), ["anthropic"], `${raw}: later candidates untouched`);
    assert.deepEqual(f.charges, []);
  }
  const credits = fakes({ ...PLATFORM, affordable: false });
  await status(run(credits.ports));
  assert.equal(credits.driverCalls.length, 0);
});

test("the user's bad BYOK key is not masked by a fallback", async () => {
  const f = fakes({ platform: ["groq"], behave: { anthropic: fail("401 invalid api key", 401), groq: ok() } });
  const r = await status(run(f.ports));
  assert.deepEqual(r, { status: 502, error: "anthropic: API key was rejected. Check it in Settings → LLM Providers." });
  assert.deepEqual(f.events[0].attemptFailures, ["auth"]);
});

test("at most three attempts, and the last failure is surfaced", async () => {
  const f = fakes({ preferred: { providerId: "openai", model: "o" }, platform: ["groq", "mistral", "anthropic"], behave: {
    openai: fail("500", 500), groq: fail("429", 429), mistral: fail("503", 503), anthropic: ok("never"),
  } });
  const r = await status(run(f.ports));
  assert.deepEqual(r, { status: 502, error: "mistral request failed. Try again in a moment." });
  assert.deepEqual(f.driverCalls.map((c) => c.providerId), ["openai", "groq", "mistral"]);
  assert.equal(f.events[0].attempts, 3);
  assert.deepEqual(f.events[0].attemptFailures, ["server", "rate_limit", "server"]);
  assert.deepEqual(f.charges, []);
});

test("fallback restarts the whole turn from scratch (same messages and prompt on every attempt)", async () => {
  const f = fakes({ ...PLATFORM, behave: { groq: fail("500", 500), mistral: ok() } });
  await run(f.ports, { ...good, history: [{ role: "assistant", content: "a" }] });
  assert.deepEqual(f.driverCalls[0].messages, f.driverCalls[1].messages);
  assert.equal(f.driverCalls[1].system, "SYS");
  assert.equal(f.calls.filter((c) => c === "prompt").length, 2);
});

// ---- deadline ----

test("attemptBudgetMs: ~55% of what remains, the last candidate gets the rest", () => {
  assert.equal(attemptBudgetMs(52_000, false), 28_600);
  assert.equal(attemptBudgetMs(23_400, false), 12_870);
  assert.equal(attemptBudgetMs(23_400, true), 23_400);
  assert.equal(attemptBudgetMs(0, true), 0);
});

test("a hung model is cut off at its share and the next candidate answers within the overall budget", async () => {
  const hang: Behavior = () => new Promise(() => {});
  const f = fakes({ ...PLATFORM, behave: { groq: hang, mistral: ok() } });
  const t0 = Date.now();
  const out = await run(f.ports, good, ctx, { ...quiet, totalBudgetMs: 400 });
  const took = Date.now() - t0;
  assert.equal(out.reply, "fallback answer");
  assert.ok(took >= 200 && took < 400, `first attempt used about 55% of 400ms (took ${took})`);
  assert.deepEqual(f.events[0].attemptFailures, ["timeout"]);
  assert.deepEqual(f.charges, [PLATFORM_DEFAULT_MODELS.mistral]);
});

test("when every candidate hangs the turn ends inside the budget with a 502 and no charge", async () => {
  const hang: Behavior = () => new Promise(() => {});
  const f = fakes({ ...PLATFORM, behave: { groq: hang, mistral: hang } });
  const t0 = Date.now();
  const r = await status(run(f.ports, good, ctx, { ...quiet, totalBudgetMs: 300 }));
  assert.ok(Date.now() - t0 < 450);
  assert.equal((r as { status: number }).status, 502);
  assert.deepEqual(f.charges, []);
});

// ---- credits ----

test("credit charged exactly once, after success, for the model that answered (fallback costs nothing extra)", async () => {
  const f = fakes({ ...PLATFORM, behave: { groq: fail("500", 500), mistral: ok() } });
  await run(f.ports);
  assert.deepEqual(f.charges, [PLATFORM_DEFAULT_MODELS.mistral]);
  const order = f.calls.join(",");
  assert.ok(order.indexOf("charge") > order.lastIndexOf("prompt"), "charge after every attempt");
  assert.equal(f.calls.filter((c) => c === "charge").length, 1);
});

test("zero charges when every attempt fails; BYOK-answered turns are never charged", async () => {
  const none = fakes({ ...PLATFORM, driverText: () => { throw new Error("500 server"); } });
  await status(run(none.ports));
  assert.deepEqual(none.charges, []);
  const byok = fakes({ platform: ["groq"] });
  await run(byok.ports);
  assert.deepEqual(byok.charges, []);
  // BYOK failed with a transient error, platform answered: that one platform answer is charged once
  const mixed = fakes({ platform: ["groq"], behave: { anthropic: fail("503", 503), groq: ok() } });
  await run(mixed.ports);
  assert.deepEqual(mixed.charges, [PLATFORM_DEFAULT_MODELS.groq]);
});

test("a failing charge cannot take the answer away from the user", async () => {
  const f = fakes({ ...PLATFORM, chargeThrows: true });
  assert.equal((await run(f.ports)).reply, "hello");
});

// ---- the client no longer chooses ----

test("legacy providerId / model / requestedProvider / requestedModel fields are ignored", async () => {
  const f = fakes({ ...PLATFORM });
  await run(f.ports, { ...good, providerId: "openai", model: "gpt-evil", requestedProvider: "openai", requestedModel: "gpt-evil" });
  assert.equal(f.driverCalls.length, 1);
  assert.equal(f.driverCalls[0].providerId, "groq");
  assert.equal(f.driverCalls[0].model, PLATFORM_DEFAULT_MODELS.groq);
  assert.equal(f.driverCalls[0].apiKey, "pk-groq");
});

test("one structured log line per turn", async () => {
  const lines: string[] = [];
  const f = fakes({ ...PLATFORM, behave: { groq: fail("500", 500), mistral: ok() } });
  await run(f.ports, good, ctx, { log: (l: string) => lines.push(l) });
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^\\[assistant\\] turn ok=true provider=mistral model=${PLATFORM_DEFAULT_MODELS.mistral} fallback=true attempts=2 ms=\\d+$`));
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

test("a limit/entitlement denial (AssistantError 402 with a code) stops the turn: one check, no fallback, error preserved", async () => {
  const denial = Object.assign(new AssistantError(402, "Monthly chat limit reached"), { code: "chat_limit" });
  let checks = 0;
  const f = fakes({ ...PLATFORM });
  f.ports.prompts = { build: async () => { checks += 1; throw denial; } };
  let caught: unknown;
  try { await run(f.ports); } catch (e) { caught = e; }
  assert.equal(caught, denial);
  assert.equal((caught as { code: string }).code, "chat_limit");
  assert.equal(checks, 1);
  assert.equal(f.driverCalls.length, 0);
  assert.deepEqual(f.charges, []);
  assert.equal(f.events[0].attempts, 1);
  assert.equal(f.events[0].fallbackUsed, false);
});
