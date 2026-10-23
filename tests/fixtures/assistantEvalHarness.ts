/**
 * Shared harness for the assistant evaluation: runs ONE case through the real runAssistantTurn (so the
 * real tool loop, budgets, caps and tool code run) with fake ports and a driver you supply: a SCRIPTED
 * fake in CI, a real provider driver in scripts/assistant-eval.mts.
 */
import { runAssistantTurn, type AssistantPorts } from "../../lib/domain/assistant/assistantService.ts";
import type { TurnContext } from "../../lib/domain/assistant/assistantTypes.ts";
import { checkReplyGrounding, type GroundingResult } from "../../lib/domain/assistant/replyGrounding.ts";
import type { DriverLike } from "../../lib/domain/chat/toolLoop.ts";
import type { EvalCase, Script } from "./assistantEval.ts";
import { EVAL_NOW, STATES } from "./assistantEvalStates.ts";

export const LOCKED_MESSAGE = "This tool is not available on the free plan. Tell the user it needs an upgrade; do not guess the data.";

export type CaseRun = {
  reply: string;
  /** Existing tools the model invoked (including ones a plan gate answered with the lock message). */
  called: string[];
  /** Tool names the model asked for that do not exist. */
  rejected: string[];
  /** Exactly what each tool call returned to the model, in order. */
  results: string[];
  /** Tool names as reported by the service (tools that actually ran). */
  serviceToolsUsed: string[];
  grounding: GroundingResult;
  error: string | null;
  ms: number;
};

/** Builds the driver for one run; `rejected` collects tool names the model asked for that do not exist. */
export type DriverFactory = (sinks: { rejected: string[] }) => DriverLike;

/** A fake "model": runs the script's tool calls through the real tool defs, then returns the scripted reply. */
export function scriptedDriver(script: Script): DriverFactory {
  return (sinks) => async (req) => {
    for (const call of script.calls) {
      const def = req.tools?.find((t) => t.name === call.tool);
      // A real driver can only execute tools it was given; anything else never reaches our code.
      if (def) await def.execute(call.input ?? {});
      else sinks.rejected.push(call.tool);
    }
    return { text: script.reply };
  };
}

export async function runCase(c: EvalCase, makeDriver: DriverFactory, opts: { model?: string; provider?: string; apiKey?: string; baseUrl?: string } = {}): Promise<CaseRun> {
  const called: string[] = [];
  const rejected: string[] = [];
  const results: string[] = [];
  const locked = c.plan === "free" ? c.gating?.lockedOnFree ?? [] : [];
  const provider = opts.provider ?? "anthropic";

  const driver = makeDriver({ rejected });
  const instrumented: DriverLike = async (req) => {
    const tools = (req.tools ?? []).map((t) => ({
      ...t,
      execute: async (input: Record<string, unknown>) => {
        called.push(t.name);
        const out = locked.includes(t.name) ? LOCKED_MESSAGE : await t.execute(input);
        results.push(out);
        return out;
      },
    }));
    return driver({ ...req, tools: req.tools ? tools : undefined });
  };

  const started = Date.now();
  let serviceToolsUsed: string[] = [];
  let error: string | null = null;
  let reply = "";
  const ports: AssistantPorts = {
    scope: { authenticate: async () => ({ userId: "eval-user" }), activeProjectId: async () => "eval-p1" },
    llm: { getDriver: () => instrumented, supportsTools: () => true },
    credentials: { resolve: async () => ({ kind: "byok", apiKey: opts.apiKey ?? "eval-key", baseUrl: opts.baseUrl }) },
    credits: { chargeBeforeAnswer: async () => ({ ok: true }) },
    prompts: { build: async () => "You are Marlo, the user's AI CMO. Be concise and honest." },
    data: { create: () => STATES[c.state] },
  };
  const ctx: TurnContext = { mode: "platform", userId: null, activeProjectId: null };
  try {
    const out = await runAssistantTurn(ports, ctx, {
      message: c.question, history: [], projectId: "eval-p1", requestedProvider: provider, requestedModel: opts.model ?? "eval-model",
    });
    reply = out.reply ?? "";
    serviceToolsUsed = out.toolsUsed;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const grounding = checkReplyGrounding(reply, results, { today: EVAL_NOW, extraGrounded: [c.question] });
  return { reply, called, rejected, results, serviceToolsUsed, grounding, error, ms: Date.now() - started };
}

/** Score a finished run against the case's expectations. Used by the live script (and sanity-checked in CI). */
export type CaseScore = {
  toolHit: boolean;
  missingTools: string[];
  extraTools: string[];
  forbiddenCalled: string[];
  /** Tool names the model asked for that do not exist (rejected by the pipeline; informational). */
  rejectedCalls: string[];
  claimedForbidden: string[];
  missedMentions: string[];
  neverAuditedSeen: boolean | null;
  groundingFlags: number;
  pass: boolean;
};

export function scoreCase(c: EvalCase, r: CaseRun): CaseScore {
  const allowed = new Set([...c.expectedTools, ...(c.allowedTools ?? [])]);
  const calledSet = new Set(r.called);
  const missingTools = c.expectedTools.filter((t) => !calledSet.has(t));
  const extraTools = [...calledSet].filter((t) => !allowed.has(t));
  const forbiddenCalled = [...new Set(r.called)].filter((t) => (c.forbiddenTools ?? []).includes(t));
  const claimedForbidden = (c.mustNotClaim ?? []).filter((re) => re.test(r.reply)).map(String);
  const missedMentions = (c.mustMention ?? []).filter((re) => !re.test(r.reply)).map(String);
  const neverAuditedSeen = c.neverAudited ? r.results.some((x) => /"neverAudited":true/.test(x)) : null;
  const toolHit = missingTools.length === 0 && extraTools.length === 0 && forbiddenCalled.length === 0;
  const groundingFlags = r.grounding.unverified.length;
  const pass = toolHit && claimedForbidden.length === 0 && missedMentions.length === 0 && !r.error && groundingFlags === 0 && neverAuditedSeen !== false;
  return { toolHit, missingTools, extraTools, forbiddenCalled, rejectedCalls: [...r.rejected], claimedForbidden, missedMentions, neverAuditedSeen, groundingFlags, pass };
}
