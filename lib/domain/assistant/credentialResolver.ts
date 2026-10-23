import type { TurnContext } from "./assistantTypes.ts";

/**
 * Outcome of looking up the key for a provider.
 * - byok: the user's own stored key (and optional base URL).
 * - platform: operator key; metered via credits. The key is read lazily, AFTER the charge.
 * - missing: provider not connected and no platform key.
 */
export type CredentialLookup =
  | { kind: "byok"; apiKey: string; baseUrl: string | undefined }
  | { kind: "platform"; loadApiKey: () => string }
  | { kind: "missing" };

/** Platform: BYOK-first via provider_connections + vault, else platform key. Self-host: provider_connections row. */
export interface CredentialPort {
  resolve(ctx: TurnContext, providerId: string): Promise<CredentialLookup>;
}

export type ChargeResult = { ok: true } | { ok: false; reason: "insufficient" };

/** Charged before the answer today; the model-policy PR moves it to after success. */
export interface CreditPort {
  chargeBeforeAnswer(ctx: TurnContext, model: string): Promise<ChargeResult>;
}
