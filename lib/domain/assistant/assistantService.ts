import { validateChatInput } from "../chat/chatLimits.ts";
import { checkChatProjectScope } from "../chat/projectScope.ts";
import { runChatTurn, type DriverLike } from "../chat/toolLoop.ts";
import type { ChatPorts } from "../chat/tools.ts";
import { DeadlineExceededError, withDeadline } from "../fixes/withDeadline.ts";
import { PLATFORM_DEFAULT_MODELS } from "../../llm/platformKeys.ts";
import { AssistantError, type AssistantTurnInput, type AssistantTurnResult, type ChatTurnMessage, type TurnContext } from "./assistantTypes.ts";
import { CHAT_LIMIT_MESSAGE, checkChatAllowance, chatLimitBody, resolveChatToolPolicy, type ChatEntitlement, type EntitlementPort } from "./chatEntitlements.ts";
import type { CredentialPort, CreditPort } from "./credentialResolver.ts";
import { friendlyProviderError } from "./errorMapping.ts";
import {
  attemptBudgetMs, attemptFailureKind, EmptyReplyError, NO_MODEL_MESSAGE, resolveModelPlan, shouldFallback,
  type ModelCandidate,
} from "./modelSelection.ts";
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
  /** Index in the candidate plan of the model that answered (0 = first choice); null when none did. */
  candidateIndex: number | null;
  /** Number of model attempts made (0 when the turn failed before any). */
  attempts: number;
  /** Failure kind of each failed attempt, in order (e.g. ["rate_limit", "timeout"]). */
  attemptFailures: string[];
};
export interface TurnObserver {
  onTurn(event: TurnEvent): void;
}
export const noopObserver: TurnObserver = { onTurn() {} };

/** Overall time budget for a turn: the route's 60s function limit minus headroom. */
export const TURN_BUDGET_MS = 52_000;
export type TurnOptions = {
  totalBudgetMs?: number;
  /** Receives the one structured line per turn; defaults to console.log. */
  log?: (line: string) => void;
};

export type AssistantPorts = {
  scope: ScopePort;
  llm: LlmPort;
  credentials: CredentialPort;
  credits: CreditPort;
  prompts: PromptPort;
  data: DataPort;
  /** Plan limits/locks for chat. Absent = no limits (self-host, tests). */
  entitlements?: EntitlementPort;
  observer?: TurnObserver;
};

/** One chat turn: tools when there's an active project, plain driver call otherwise. */
async function answer(args: {
  driver: DriverLike; supportsTools: boolean; apiKey: string; model: string; baseUrl?: string; system: string;
  messages: ChatTurnMessage[]; ports: ChatPorts | null; lockedTools?: readonly string[];
}): Promise<AssistantTurnResult> {
  if (!args.ports) {
    const result = await args.driver({ apiKey: args.apiKey, model: args.model, system: args.system, messages: args.messages, baseUrl: args.baseUrl });
    return { reply: result.text, toolsUsed: [], lookedAt: [] };
  }
  const run = await runChatTurn({
    driver: args.driver, apiKey: args.apiKey, model: args.model, baseUrl: args.baseUrl, system: args.system,
    messages: args.messages, ports: args.ports, supportsTools: args.supportsTools, lockedTools: args.lockedTools,
  });
  return { reply: run.text, toolsUsed: run.toolsUsed, lookedAt: run.lookedAt };
}

/** The candidate had no usable key at attempt time (e.g. disconnected since the plan was built): try the next one. */
class CandidateUnavailable extends Error {}

type AttemptOutcome = { result: AssistantTurnResult; paidWithPlatformKey: boolean };

/**
 * Everything that happens for ONE model candidate: credentials -> credit check -> prompt -> data ports -> answer,
 * raced against `budgetMs`. Charges nothing: the caller charges once, after a successful reply.
 * A failure's `cause` carries the raw provider error (or EmptyReplyError) for the fallback decision.
 */
export async function attemptWithCandidate(
  ports: AssistantPorts, ctx: TurnContext, candidate: ModelCandidate, messages: ChatTurnMessage[], budgetMs = Infinity,
): Promise<AttemptOutcome> {
  const { providerId, model } = candidate;
  const cred = await ports.credentials.resolve(ctx, providerId);
  if (cred.kind === "missing") throw new CandidateUnavailable(`${providerId} has no usable key`);

  const paidWithPlatformKey = cred.kind === "platform";
  let knownEntitlement: ChatEntitlement | undefined;
  if (paidWithPlatformKey) {
    // Monthly plan cap first (BYOK, self-host and not-enforced skip it). A denial is a non-502 AssistantError: no fallback, no charge.
    if (ports.entitlements) {
      const allowance = await checkChatAllowance(ports.entitlements, ctx);
      knownEntitlement = { plan: allowance.plan, enforced: allowance.enforced };
      if (!allowance.allowed) throw new AssistantError(402, CHAT_LIMIT_MESSAGE, undefined, chatLimitBody(allowance));
    }
    // Read-only affordability check; the actual charge happens once, after a successful reply.
    const afford = await ports.credits.canAfford(ctx);
    if (!afford.ok) throw new AssistantError(402, "Out of credits. Upgrade or connect your own key.");
  }

  try {
    const result = await withDeadline(async () => {
      const apiKey = cred.kind === "byok" ? cred.apiKey : cred.loadApiKey(); // platform key: baseUrl intentionally not set
      const baseUrl = cred.kind === "byok" ? cred.baseUrl : undefined;
      const policy = await resolveChatToolPolicy(ports.entitlements, ctx, knownEntitlement);
      const built = await ports.prompts.build(ctx);
      const system = policy.note ? `${built}

${policy.note}` : built;
      const driver = ports.llm.getDriver(providerId)!;
      return answer({
        driver, supportsTools: ports.llm.supportsTools(providerId), apiKey, model, baseUrl, system,
        messages, ports: await ports.data.create(ctx), lockedTools: policy.lockedTools,
      });
    }, budgetMs).catch((e) => { throw e instanceof DeadlineExceededError ? new Error("request timed out") : e; });
    if (!result.reply || !result.reply.trim()) throw new EmptyReplyError();
    return { result, paidWithPlatformKey };
  } catch (err) {
    // Policy/limit denials (402 chat_limit, 400, 401, 409...) pass through untouched and are never retried.
    if (err instanceof AssistantError) throw err;
    throw new AssistantError(502, friendlyProviderError(providerId, err), err);
  }
}

function errorKindOf(err: unknown): string {
  if (err instanceof AssistantError) {
    if (err.status === 502) return attemptFailureKind(err.cause);
    return `http_${err.status}`;
  }
  return "internal";
}

/** validate -> auth -> project scope -> model plan -> per candidate (max 3): attempt, fall back on transient failure -> charge once. */
export async function runAssistantTurn(
  ports: AssistantPorts, ctx: TurnContext, input: AssistantTurnInput, opts: TurnOptions = {},
): Promise<AssistantTurnResult> {
  const started = Date.now();
  const totalBudget = opts.totalBudgetMs ?? TURN_BUDGET_MS;
  let modelUsed: TurnEvent["modelUsed"] = null;
  let lastTried: ModelCandidate | null = null;
  let candidateIndex: number | null = null;
  let toolsUsed: string[] = [];
  let errorKind: string | null = null;
  let attempts = 0;
  const attemptFailures: string[] = [];
  try {
    const inputCheck = validateChatInput(input.message, input.history);
    if (!inputCheck.ok) throw new AssistantError(400, inputCheck.error);
    const messages: ChatTurnMessage[] = [...inputCheck.history, { role: "user", content: input.message as string }];

    const session = await ports.scope.authenticate(ctx);
    if (!session) throw new AssistantError(401, "Not authenticated");
    let turnCtx: TurnContext = { ...ctx, userId: session.userId };

    // Verify the client's project before any credit is charged or history is used.
    turnCtx = { ...turnCtx, activeProjectId: await ports.scope.activeProjectId(turnCtx) };
    const scope = checkChatProjectScope(input.projectId, turnCtx.activeProjectId);
    if (!scope.ok) throw new AssistantError(409, scope.error);

    // The SERVER picks the models; nothing the client sent can steer provider or key.
    const plan = await resolveModelPlan(turnCtx, {
      hasDriver: (id) => ports.llm.getDriver(id) !== null,
      preferred: () => ports.credentials.preferredModel(turnCtx),
      platformAvailable: (id) => ports.credentials.platformAvailable(id),
      platformDefaults: {
        primary: { providerId: "groq", model: PLATFORM_DEFAULT_MODELS.groq },
        secondary: { providerId: "mistral", model: PLATFORM_DEFAULT_MODELS.mistral },
      },
    });

    let lastError: unknown = null;
    for (let i = 0; i < plan.length; i += 1) {
      const candidate = plan[i];
      const isLast = i === plan.length - 1;
      const remaining = totalBudget - (Date.now() - started);
      if (remaining <= 0) break;
      lastTried = candidate;
      attempts += 1;
      try {
        const { result, paidWithPlatformKey } = await attemptWithCandidate(
          ports, turnCtx, candidate, messages, attemptBudgetMs(remaining, isLast),
        );
        modelUsed = { providerId: candidate.providerId, model: candidate.model };
        candidateIndex = i;
        toolsUsed = result.toolsUsed;
        // Charge exactly once, only now that the user has an answer. BYOK is never charged.
        if (paidWithPlatformKey) {
          try { await ports.credits.charge(turnCtx, candidate.model); } catch { /* the user already has their answer */ }
        }
        return result;
      } catch (err) {
        if (err instanceof CandidateUnavailable) {
          attempts -= 1; // never reached a model
          lastError = new AssistantError(422, NO_MODEL_MESSAGE);
          continue;
        }
        // Only provider failures (wrapped as 502) may fall back; every other AssistantError stops the turn.
        const cause = err instanceof AssistantError && err.status === 502 ? err.cause : undefined;
        attemptFailures.push(errorKindOf(err));
        lastError = err;
        if (!isLast && shouldFallback(cause)) continue;
        throw err;
      }
    }
    throw lastError ?? new AssistantError(502, "The assistant took too long to answer. Try again in a moment.");
  } catch (err) {
    errorKind = errorKindOf(err);
    throw err;
  } finally {
    const durationMs = Date.now() - started;
    const shown = modelUsed ?? (lastTried ? { providerId: lastTried.providerId, model: lastTried.model } : null);
    try {
      (opts.log ?? console.log)(
        `[assistant] turn ok=${errorKind === null} provider=${shown?.providerId ?? "-"} model=${shown?.model ?? "-"} ` +
        `fallback=${candidateIndex !== null && candidateIndex > 0} attempts=${attempts} ms=${durationMs}`,
      );
    } catch { /* logging must never break a turn */ }
    try {
      (ports.observer ?? noopObserver).onTurn({
        modelUsed, toolsUsed, fallbackUsed: candidateIndex !== null && candidateIndex > 0, durationMs, errorKind,
        candidateIndex, attempts, attemptFailures,
      });
    } catch { /* observers must never break a turn */ }
  }
}
