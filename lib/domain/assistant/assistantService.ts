import { validateChatInput } from "../chat/chatLimits.ts";
import { checkChatProjectScope } from "../chat/projectScope.ts";
import { runChatTurn, type DriverLike } from "../chat/toolLoop.ts";
import type { ChatPorts } from "../chat/tools.ts";
import { AssistantError, type AssistantTurnInput, type AssistantTurnResult, type ChatTurnMessage, type TurnContext } from "./assistantTypes.ts";
import type { CredentialPort, CreditPort } from "./credentialResolver.ts";
import { classifyProviderError, friendlyProviderError } from "./errorMapping.ts";
import { resolveModelPlan, shouldFallback, type ModelCandidate } from "./modelSelection.ts";
import type { PromptPort } from "./promptBuilder.ts";
import type { DataPort } from "./toolRegistry.ts";

/** Who is calling and which project they are on. Platform: Supabase auth; self-host: no auth. */
export interface ScopePort {
  /** null = not authenticated. */
  authenticate(ctx: TurnContext): Promise<{ userId: string | null } | null>;
  activeProjectId(ctx: TurnContext): Promise<string | null>;
}

export interface LlmPort {
  getDriver(providerId: string): DriverLike | null;
  supportsTools(providerId: string): boolean;
}

/** Metadata about one finished turn. NEVER message content, replies or secrets. */
export type TurnEvent = {
  modelUsed: { providerId: string; model: string } | null;
  toolsUsed: string[];
  fallbackUsed: boolean;
  durationMs: number;
  /** null on success. */
  errorKind: string | null;
};
export interface TurnObserver {
  onTurn(event: TurnEvent): void;
}
export const noopObserver: TurnObserver = { onTurn() {} };

export type AssistantPorts = {
  scope: ScopePort;
  llm: LlmPort;
  credentials: CredentialPort;
  credits: CreditPort;
  prompts: PromptPort;
  data: DataPort;
  observer?: TurnObserver;
};

/** One chat turn: tools when there's an active project, plain driver call otherwise. */
async function answer(args: {
  driver: DriverLike; supportsTools: boolean; apiKey: string; model: string; baseUrl?: string; system: string;
  messages: ChatTurnMessage[]; ports: ChatPorts | null;
}): Promise<AssistantTurnResult> {
  if (!args.ports) {
    const result = await args.driver({ apiKey: args.apiKey, model: args.model, system: args.system, messages: args.messages, baseUrl: args.baseUrl });
    return { reply: result.text, toolsUsed: [], lookedAt: [] };
  }
  const run = await runChatTurn({
    driver: args.driver, apiKey: args.apiKey, model: args.model, baseUrl: args.baseUrl, system: args.system,
    messages: args.messages, ports: args.ports, supportsTools: args.supportsTools,
  });
  return { reply: run.text, toolsUsed: run.toolsUsed, lookedAt: run.lookedAt };
}

/** Everything that happens for ONE model candidate: credentials -> credits -> prompt -> data ports -> answer. */
export async function attemptWithCandidate(
  ports: AssistantPorts, ctx: TurnContext, candidate: ModelCandidate, messages: ChatTurnMessage[],
): Promise<AssistantTurnResult> {
  const { providerId, model } = candidate;
  const cred = await ports.credentials.resolve(ctx, providerId);
  if (cred.kind === "missing") {
    throw new AssistantError(422, `${providerId} isn't connected yet. Connect it in Settings → LLM Providers.`);
  }

  let apiKey: string;
  let baseUrl: string | undefined;
  if (cred.kind === "byok") {
    apiKey = cred.apiKey;
    baseUrl = cred.baseUrl;
  } else {
    // Closed-source: platform-provided key, metered via credits.
    const charge = await ports.credits.chargeBeforeAnswer(ctx, model);
    if (!charge.ok) throw new AssistantError(402, "Out of credits. Upgrade or connect your own key.");
    apiKey = cred.loadApiKey(); // platform key: baseUrl intentionally not set
  }

  try {
    // Note: credits already charged for this message — no refund path yet on generation failure.
    const system = await ports.prompts.build(ctx);
    const driver = ports.llm.getDriver(providerId)!;
    return await answer({
      driver, supportsTools: ports.llm.supportsTools(providerId), apiKey, model, baseUrl, system,
      messages, ports: ports.data.create(ctx),
    });
  } catch (err) {
    throw new AssistantError(502, friendlyProviderError(providerId, err), err);
  }
}

function errorKindOf(err: unknown): string {
  if (err instanceof AssistantError) {
    if (err.status === 502) return classifyProviderError(err.cause).kind;
    return `http_${err.status}`;
  }
  return "internal";
}

/** validate -> project scope -> model plan -> (per candidate) credentials/credits/prompt/data/answer -> map errors. */
export async function runAssistantTurn(
  ports: AssistantPorts, ctx: TurnContext, input: AssistantTurnInput,
): Promise<AssistantTurnResult> {
  const started = Date.now();
  let modelUsed: TurnEvent["modelUsed"] = null;
  let toolsUsed: string[] = [];
  let errorKind: string | null = null;
  try {
    const inputCheck = validateChatInput(input.message, input.history);
    if (!inputCheck.ok) throw new AssistantError(400, inputCheck.error);
    const messages: ChatTurnMessage[] = [...inputCheck.history, { role: "user", content: input.message as string }];

    const plan = resolveModelPlan(ctx, input, { hasDriver: (id) => ports.llm.getDriver(id) !== null });

    const session = await ports.scope.authenticate(ctx);
    if (!session) throw new AssistantError(401, "Not authenticated");
    let turnCtx: TurnContext = { ...ctx, userId: session.userId };

    // Verify the client's project before any credit is charged or history is used.
    turnCtx = { ...turnCtx, activeProjectId: await ports.scope.activeProjectId(turnCtx) };
    const scope = checkChatProjectScope(input.projectId, turnCtx.activeProjectId);
    if (!scope.ok) throw new AssistantError(409, scope.error);

    for (let i = 0; i < plan.length; i += 1) {
      const candidate = plan[i];
      try {
        const out = await attemptWithCandidate(ports, turnCtx, candidate, messages);
        modelUsed = { providerId: candidate.providerId, model: candidate.model };
        toolsUsed = out.toolsUsed;
        return out;
      } catch (err) {
        if (i < plan.length - 1 && shouldFallback(err)) continue;
        throw err;
      }
    }
    // Unreachable: resolveModelPlan returns at least one candidate or throws.
    throw new AssistantError(422, "No model selected. Connect a provider in Settings → LLM Providers.");
  } catch (err) {
    errorKind = errorKindOf(err);
    throw err;
  } finally {
    try {
      (ports.observer ?? noopObserver).onTurn({
        modelUsed, toolsUsed, fallbackUsed: false, durationMs: Date.now() - started, errorKind,
      });
    } catch { /* observers must never break a turn */ }
  }
}
