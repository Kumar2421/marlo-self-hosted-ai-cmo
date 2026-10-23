import { AssistantError, type TurnContext } from "./assistantTypes.ts";
import { classifyProviderError, type ProviderErrorKind } from "./errorMapping.ts";

export type CredentialSource = "auto" | "byok" | "platform" | "selfhost";

/** One model the turn may be answered with. `auto` = CredentialPort decides (BYOK first, then platform key). */
export type ModelCandidate = { providerId: string; model: string; credentialSource: CredentialSource; role: "preferred" | "default" | "secondary" };

/** The platform's own models, in order. Kept here (not imported from platformKeys) so the policy stays pure. */
export type PlatformDefaults = { primary: { providerId: string; model: string }; secondary: { providerId: string; model: string } };

export type ModelSelectionDeps = {
  /** True when a real driver is wired for this provider. */
  hasDriver: (providerId: string) => boolean;
  /** The user's saved preferred model, only when they connected a usable key for its provider. Else null. */
  preferred: () => Promise<{ providerId: string; model: string } | null>;
  /** True when the operator's platform key exists for this provider (hosted only). */
  platformAvailable: (providerId: string) => boolean;
  platformDefaults: PlatformDefaults;
};

export const MAX_ATTEMPTS = 3;
export const NO_MODEL_MESSAGE = "AI isn't available right now. Connect a provider in Settings > LLM Providers.";

/**
 * ORDERED candidates: (a) the user's preferred model (BYOK), (b) platform default, (c) platform secondary.
 * Candidates whose provider has no driver or no usable key are skipped; providers are deduped (one provider
 * resolves to one key, so a second model of the same provider adds nothing). The CLIENT never chooses.
 * Self-host has no platform keys: only the preferred model. Throws AssistantError 422 when the list is empty.
 */
export async function resolveModelPlan(ctx: TurnContext, deps: ModelSelectionDeps): Promise<ModelCandidate[]> {
  const out: ModelCandidate[] = [];
  const seen = new Set<string>();
  const add = (c: { providerId: string; model: string }, role: ModelCandidate["role"], source: CredentialSource) => {
    if (seen.has(c.providerId) || !deps.hasDriver(c.providerId)) return;
    seen.add(c.providerId);
    out.push({ providerId: c.providerId, model: c.model, credentialSource: source, role });
  };

  const preferred = await deps.preferred();
  if (preferred) add(preferred, "preferred", ctx.mode === "selfhost" ? "selfhost" : "byok");
  if (ctx.mode !== "selfhost") {
    for (const [d, role] of [[deps.platformDefaults.primary, "default"], [deps.platformDefaults.secondary, "secondary"]] as const) {
      if (deps.platformAvailable(d.providerId)) add(d, role, "platform");
    }
  }
  if (out.length === 0) throw new AssistantError(422, NO_MODEL_MESSAGE);
  return out.slice(0, MAX_ATTEMPTS);
}

/** A reply with no text is a failed attempt (fall back), not a success. */
export class EmptyReplyError extends Error {
  constructor() { super("empty reply"); this.name = "EmptyReplyError"; }
}

const FALLBACK_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  "rate_limit", "server", "timeout", "network", "model_unavailable",
]);

/** Failure kind of one attempt, for logs and the fallback decision. `cause` is the raw provider error. */
export function attemptFailureKind(cause: unknown): string {
  if (cause instanceof EmptyReplyError) return "empty";
  return classifyProviderError(cause).kind;
}

/**
 * Should the next candidate be tried? Yes for rate_limit / server / timeout / network / model_unavailable / empty reply.
 * NEVER for auth (a bad user key is surfaced), bad_request, unknown, out-of-credits or input errors:
 * those arrive here as non-provider errors (`cause` undefined) and are refused.
 */
export function shouldFallback(cause: unknown): boolean {
  if (cause === undefined || cause === null) return false;
  if (cause instanceof EmptyReplyError) return true;
  return FALLBACK_KINDS.has(classifyProviderError(cause).kind);
}

/** Time for one attempt: all but the last get ~55% of what remains, the last gets the rest. */
export const FIRST_ATTEMPT_SHARE = 0.55;
export function attemptBudgetMs(remainingMs: number, isLastCandidate: boolean): number {
  if (remainingMs <= 0) return 0;
  return isLastCandidate ? remainingMs : Math.floor(remainingMs * FIRST_ATTEMPT_SHARE);
}
