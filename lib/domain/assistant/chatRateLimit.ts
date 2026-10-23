import type { RateLimiter } from "../net/rateLimit.ts";
import type { AssistantPorts } from "./assistantService.ts";
import type { TurnContext } from "./assistantTypes.ts";

/** Per-user request limit on the chat endpoint. Monthly/plan limits are a separate concern. */
export const CHAT_RATE_LIMIT = 12;
export const CHAT_RATE_WINDOW_SEC = 60;

export const CHAT_RATE_MESSAGE = "You are sending messages very quickly. Please wait a moment and try again.";

export type RateGuard =
  | { ok: true; ports: AssistantPorts }
  | { ok: false; status: 429; error: string; retryAfterSec: number };

/**
 * Counts one request against the signed-in user (or "local" on self-host). Unauthenticated callers
 * are not counted here: the service answers them with 401 as usual. Authentication runs once; the
 * result is reused by the turn so there is no second auth round trip.
 */
export async function guardChatRate(
  ports: AssistantPorts, ctx: TurnContext, limiter: RateLimiter,
  limit = CHAT_RATE_LIMIT, windowSec = CHAT_RATE_WINDOW_SEC,
): Promise<RateGuard> {
  const authenticate = ports.scope.authenticate.bind(ports.scope);
  let pending: ReturnType<typeof authenticate> | null = null;
  const once: typeof authenticate = (c) => (pending ??= authenticate(c));
  const wrapped: AssistantPorts = { ...ports, scope: { ...ports.scope, authenticate: once } };

  let session: Awaited<ReturnType<typeof authenticate>> = null;
  try { session = await once(ctx); } catch { return { ok: true, ports: wrapped }; }
  if (!session) return { ok: true, ports: wrapped };

  const hit = await limiter.hit(`chat:${session.userId ?? "local"}`, windowSec, limit);
  if (!hit.allowed) return { ok: false, status: 429, error: CHAT_RATE_MESSAGE, retryAfterSec: Math.max(1, hit.retryAfterSec) };
  return { ok: true, ports: wrapped };
}
