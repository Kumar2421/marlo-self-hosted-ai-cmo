import type { TurnContext } from "./assistantTypes.ts";
import type { PlanInfoPlan } from "../plans/planInfo.ts";
import { UNLIMITED, type FeatureId, type PlanId } from "../plans/planMatrix.ts";
import { can, limit } from "../plans/planPolicy.ts";

/**
 * Chat plan limits and locks. Pure logic plus one port for the reads.
 * Everything here follows the same enforcement switch as the other plan limits
 * (app_config.billing_enabled): when it is off, nothing is limited or locked.
 */

export type ChatEntitlement = { plan: PlanInfoPlan; enforced: boolean };

/** Reads only. The adapters (platformAdapters.ts) are the only place that touches the DB. */
export interface EntitlementPort {
  /** Plan and enforcement switch for the signed-in user. */
  entitlement(ctx: TurnContext): Promise<ChatEntitlement>;
  /**
   * Successful platform-key chat messages in [from, to). BYOK-answered messages
   * are never charged, so they are not in the usage records and not counted.
   */
  countPlatformChatMessages(ctx: TurnContext, from: Date, to: Date): Promise<number>;
}

export type ChatAllowance = {
  allowed: boolean;
  used: number;
  /** -1 = unlimited. */
  limit: number;
  /** -1 = unlimited. */
  remaining: number;
  /** ISO time the monthly count starts over (start of next UTC month), or null when there is no cap. */
  resetsAt: string | null;
  plan: PlanInfoPlan;
  enforced: boolean;
};

export const CHAT_LIMIT_CODE = "chat_limit";
export const CHAT_LIMIT_MESSAGE = "You have used your free chats for this month.";

/** UTC calendar month containing `now`: [start, end) where `end` is when the count resets. */
export function utcMonthWindow(now: Date): { start: Date; end: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
}

const NO_CAP = (e: ChatEntitlement): ChatAllowance => ({
  allowed: true, used: 0, limit: UNLIMITED, remaining: UNLIMITED, resetsAt: null, plan: e.plan, enforced: e.enforced,
});

/**
 * May this user send one more platform-key chat message?
 * - Self-host, not enforced, or an unlimited plan: allowed, no count query.
 * - A failed lookup never blocks the user (fails open); the plan system's own
 *   fail-closed rules live in loadEntitlement.
 * Callers skip this for BYOK candidates.
 */
export async function checkChatAllowance(
  port: EntitlementPort,
  ctx: TurnContext,
  opts: { now?: Date; entitlement?: ChatEntitlement } = {},
): Promise<ChatAllowance> {
  if (ctx.mode === "selfhost") return NO_CAP({ plan: "selfhost", enforced: false });

  let ent = opts.entitlement;
  if (!ent) {
    try {
      ent = await port.entitlement(ctx);
    } catch {
      return NO_CAP({ plan: "free", enforced: false });
    }
  }
  if (ent.plan === "selfhost" || !ent.enforced) return NO_CAP(ent);

  const cap = limit(ent.plan, "chat_messages_per_month");
  if (cap < 0) return NO_CAP(ent);

  const { start, end } = utcMonthWindow(opts.now ?? new Date());
  let used: number;
  try {
    used = await port.countPlatformChatMessages(ctx, start, end);
  } catch {
    return { ...NO_CAP(ent), limit: cap, remaining: cap, resetsAt: end.toISOString() };
  }
  const remaining = Math.max(0, cap - used);
  return { allowed: used < cap, used, limit: cap, remaining, resetsAt: end.toISOString(), plan: ent.plan, enforced: true };
}

/** Body of the 402 the chat returns when the monthly cap is reached. */
export function chatLimitBody(a: ChatAllowance): Record<string, unknown> {
  return { error: CHAT_LIMIT_MESSAGE, code: CHAT_LIMIT_CODE, used: a.used, limit: a.limit, resetsAt: a.resetsAt, plan: a.plan };
}

// ---------------------------------------------------------------------------
// Feature gating
// ---------------------------------------------------------------------------

/** Chat tools that need the paid `chat_deep_tools` feature (GEO, audit/technical detail). */
export const DEEP_CHAT_TOOLS: readonly string[] = ["get_geo_status", "get_audit_summary"];

export type ChatFeatureGate = {
  /** True when the user may use the feature right now. Always true when not enforced or on self-host. */
  canUse(feature: FeatureId): boolean;
};

export function chatFeatureGate(ent: ChatEntitlement | null | undefined): ChatFeatureGate {
  if (!ent || !ent.enforced || ent.plan === "selfhost") return { canUse: () => true };
  const plan: PlanId = ent.plan;
  return { canUse: (feature) => can(plan, feature) };
}

export type ChatToolPolicy = {
  /** Tool names the model must not be given. */
  lockedTools: string[];
  /** Appended to the system prompt so the model says "that needs a paid plan" instead of guessing. Empty when nothing is locked. */
  note: string;
};

export function chatToolPolicy(gate: ChatFeatureGate): ChatToolPolicy {
  const lockedTools = gate.canUse("chat_deep_tools") ? [] : [...DEEP_CHAT_TOOLS];
  const lines: string[] = [];
  if (lockedTools.length > 0) {
    lines.push("Deeper lookups (AI search / GEO status and technical audit detail) are a paid-plan feature and are not available to this user. If they ask for that detail, say plainly that it needs a paid plan. Do not guess or make up those results.");
  }
  if (!gate.canUse("chat_start_audit")) {
    lines.push("Starting an SEO audit from this chat is a paid-plan feature. If asked to run one, say it needs a paid plan (they can still run an audit from the dashboard).");
  }
  return { lockedTools, note: lines.length ? `Plan limits for this user:\n${lines.join("\n")}` : "" };
}

/** Tool policy for this user. Never throws: a failed lookup means nothing is locked. */
export async function resolveChatToolPolicy(port: EntitlementPort | undefined, ctx: TurnContext, known?: ChatEntitlement): Promise<ChatToolPolicy> {
  if (!port || ctx.mode === "selfhost") return { lockedTools: [], note: "" };
  try {
    return chatToolPolicy(chatFeatureGate(known ?? (await port.entitlement(ctx))));
  } catch {
    return { lockedTools: [], note: "" };
  }
}
