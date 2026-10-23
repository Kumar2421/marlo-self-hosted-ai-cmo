import { AssistantError, type AssistantTurnInput, type TurnContext } from "./assistantTypes.ts";

export type CredentialSource = "auto" | "byok" | "platform" | "selfhost";

/** One model the turn may be answered with. `auto` = CredentialPort decides (BYOK first, then platform key). */
export type ModelCandidate = { providerId: string; model: string; credentialSource: CredentialSource };

export type ModelSelectionDeps = {
  /** True when a real driver is wired for this provider. */
  hasDriver: (providerId: string) => boolean;
};

/**
 * ORDERED list of models to try. Today: exactly the client-sent provider + model.
 * The model-policy PR changes only this file (and shouldFallback) to add fallbacks.
 * Throws AssistantError 422 (nothing selected) / 501 (no driver).
 */
export function resolveModelPlan(ctx: TurnContext, input: AssistantTurnInput, deps: ModelSelectionDeps): ModelCandidate[] {
  const model = input.requestedModel;
  const providerId = input.requestedProvider;
  if (!model || !providerId) {
    throw new AssistantError(422, "No model selected. Connect a provider in Settings → LLM Providers.");
  }
  if (!deps.hasDriver(providerId)) {
    throw new AssistantError(501, `${providerId} isn't wired to a real model yet — only Anthropic, OpenAI, and Google are live so far.`);
  }
  return [{ providerId, model, credentialSource: ctx.mode === "selfhost" ? "selfhost" : "auto" }];
}

/** Should the next candidate be tried after this failure? Stub: never, until the model-policy PR. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function shouldFallback(_error: unknown): boolean {
  return false;
}
