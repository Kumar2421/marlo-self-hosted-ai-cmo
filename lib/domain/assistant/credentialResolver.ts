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
  /** The user's preferred model: only when a provider key of theirs is connected AND a primary model is saved. */
  preferredModel(ctx: TurnContext): Promise<{ providerId: string; model: string } | null>;
  /** True when the operator's platform key for this provider exists (hosted). Always false on self-host. */
  platformAvailable(providerId: string): boolean;
}

export type ChargeResult = { ok: true } | { ok: false; reason: "insufficient" };

/**
 * Platform-key turns only (BYOK is never charged). The service checks `canAfford` BEFORE an attempt (read-only)
 * and calls `charge` exactly ONCE per user message, AFTER a successful reply. Failed attempts and fallbacks cost nothing.
 */
export interface CreditPort {
  canAfford(ctx: TurnContext): Promise<ChargeResult>;
  charge(ctx: TurnContext, model: string): Promise<ChargeResult>;
}

/**
 * Pure: which provider does the saved primary model belong to, among providers the user has connected?
 * Matches the provider whose model list contains it; for an unlisted id (custom/local server model) falls back to
 * the user's only connection. Returns null when nothing is saved or connected, so a stale primary never wins.
 */
export function pickPreferredModel(
  primaryModel: string | null | undefined,
  connectedProviderIds: readonly string[],
  providerModels: ReadonlyArray<{ id: string; models: readonly string[] }>,
): { providerId: string; model: string } | null {
  const model = primaryModel?.trim();
  if (!model || connectedProviderIds.length === 0) return null;
  const owner = providerModels.find((p) => p.models.includes(model));
  if (owner) return connectedProviderIds.includes(owner.id) ? { providerId: owner.id, model } : null;
  return connectedProviderIds.length === 1 ? { providerId: connectedProviderIds[0], model } : null;
}
