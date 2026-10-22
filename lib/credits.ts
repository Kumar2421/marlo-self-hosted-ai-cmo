import { createServiceClient } from "@/utils/supabase/serviceClient";
import { InsufficientCreditsError } from "@/lib/domain/credits/errors.ts";
import { SETUP_FREE_REASON, type SetupFacts } from "@/lib/domain/credits/setupFree.ts";
import { spendOrFreeSetup, type CreditTicket, type SpendOptions, type SpendPorts, type SpendReceipt } from "@/lib/domain/credits/spend.ts";

export { InsufficientCreditsError };
export type { CreditTicket };

/**
 * Charges credits for one agent action via the spend_credits RPC (atomic
 * check-then-decrement in Postgres — see migration 02_credit_system).
 * Platform mode only. Throws InsufficientCreditsError if the user can't
 * afford it; caller should turn that into a 402 response.
 */
export async function chargeCredits(
  userId: string,
  agentType: string,
  opts?: { projectId?: string; model?: string; tokensIn?: number; tokensOut?: number }
) {
  const db = createServiceClient();
  const { data, error } = await db.rpc("spend_credits", {
    p_user_id: userId,
    p_agent_type: agentType,
    p_project_id: opts?.projectId ?? null,
    p_model: opts?.model ?? null,
    p_tokens_in: opts?.tokensIn ?? null,
    p_tokens_out: opts?.tokensOut ?? null,
  });

  if (error) {
    if (error.message?.includes("insufficient_credits")) throw new InsufficientCreditsError();
    throw new Error(error.message);
  }

  return data;
}

/**
 * Read-only balance check used BEFORE an expensive call on the platform key.
 * Mirrors spend_credits(): nothing blocks while billing_enabled is false.
 */
export async function getCreditState(userId: string, agentType: string): Promise<{ billingEnabled: boolean; balance: number; cost: number }> {
  const db = createServiceClient();
  const [{ data: profile }, { data: config }, { data: cost }] = await Promise.all([
    db.from("profiles").select("credits_balance").eq("id", userId).maybeSingle(),
    db.from("app_config").select("billing_enabled").eq("id", true).maybeSingle(),
    db.from("credit_costs").select("credits").eq("agent_type", agentType).maybeSingle(),
  ]);
  return {
    billingEnabled: config?.billing_enabled ?? false,
    balance: profile?.credits_balance ?? 0,
    cost: cost?.credits ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Setup-free spend + refund-on-failure (ports for lib/domain/credits/spend.ts)
// ---------------------------------------------------------------------------

type ServiceDb = ReturnType<typeof createServiceClient>;

function receiptOf(data: unknown): SpendReceipt {
  const row = (data ?? {}) as { id?: string; credits_charged?: number };
  return { eventId: row.id ?? null, credits: row.credits_charged ?? 0 };
}

function supabaseSpendPorts(db: ServiceDb): SpendPorts {
  return {
    async billingEnabled() {
      const { data } = await db.from("app_config").select("billing_enabled").eq("id", true).maybeSingle();
      return data?.billing_enabled ?? false;
    },

    // Every fact comes from the database, keyed by the authenticated user id.
    async setupFacts(userId: string, projectId: string, agentType: string): Promise<SetupFacts | null> {
      const [project, count, same, other] = await Promise.all([
        db.from("projects").select("created_at").eq("id", projectId).eq("owner_id", userId).maybeSingle(),
        db.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", userId),
        db.from("usage_events").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("project_id", projectId).eq("agent_type", agentType).eq("status", "ok"),
        // A free setup already granted for another (maybe since deleted) project;
        // project_id goes null when its project is deleted.
        db.from("usage_events").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("credits_charged", 0).eq("status", "ok")
          .or(`project_id.is.null,project_id.neq.${projectId}`),
      ]);
      if (project.error || count.error || same.error || other.error || !project.data) return null;
      return {
        projectCount: count.count ?? 0,
        projectCreatedAt: project.data.created_at ?? null,
        priorSameTypeEvents: same.count ?? 0,
        otherSetupUsed: (other.count ?? 0) > 0,
      };
    },

    async charge(userId: string, agentType: string, opts: SpendOptions) {
      return receiptOf(await chargeCredits(userId, agentType, opts));
    },

    async logFreeSetup(userId: string, agentType: string, opts: SpendOptions) {
      const { data, error } = await db
        .from("usage_events")
        .insert({
          user_id: userId,
          project_id: opts.projectId ?? null,
          agent_type: agentType,
          model: opts.model ?? null,
          tokens_in: opts.tokensIn ?? null,
          tokens_out: opts.tokensOut ?? null,
          credits_charged: 0,
          status: "ok",
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "could not record setup usage");
      // Ledger row (delta 0) keeps the reason visible next to real spends.
      await db.from("credit_ledger").insert({
        user_id: userId,
        delta: 0,
        reason: SETUP_FREE_REASON,
        ref_type: "usage_event",
        ref_id: data.id,
      });
      return { eventId: data.id as string, credits: 0 };
    },

    async refund(eventId: string) {
      const { data, error } = await db.rpc("refund_credits", { p_event_id: eventId });
      if (error) throw new Error(error.message);
      return Boolean((data as { changed?: boolean } | null)?.changed ?? true);
    },

    now: () => new Date(),
  };
}

/**
 * Drop-in replacement for chargeCredits() that also returns a ticket.
 * - First-project setup actions are free (decided here from DB facts; only when
 *   billing is enabled, so behaviour with billing off is unchanged).
 * - ticket.refund() gives the credits back (or marks a free run failed). Safe to
 *   call more than once and never throws. Needs migration credit_refund.sql;
 *   until it is applied a refund attempt is logged and skipped.
 * Throws InsufficientCreditsError exactly like chargeCredits().
 */
export async function spendCredits(userId: string, agentType: string, opts: SpendOptions = {}): Promise<CreditTicket> {
  return spendOrFreeSetup(supabaseSpendPorts(createServiceClient()), userId, agentType, opts, (err) => {
    console.error("[credits] refund failed", { userId, agentType, error: err instanceof Error ? err.message : String(err) });
  });
}

export { withRefund, isFailedResponse } from "@/lib/domain/credits/spend.ts";
