/**
 * Spend -> work -> refund orchestration. Pure: all I/O goes through ports so it
 * can be tested with in-memory fakes. lib/credits.ts supplies the Supabase ports.
 */
import { isSetupFree, isSetupFreeAgentType, type SetupFacts } from "./setupFree.ts";

export interface SpendOptions {
  projectId?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface SpendReceipt {
  eventId: string | null;
  credits: number;
}

export interface SpendPorts {
  billingEnabled(): Promise<boolean>;
  /** DB facts for the setup decision; null when they cannot be read. */
  setupFacts(userId: string, projectId: string, agentType: string): Promise<SetupFacts | null>;
  /** Regular metered charge (spend_credits). Throws InsufficientCreditsError. */
  charge(userId: string, agentType: string, opts: SpendOptions): Promise<SpendReceipt>;
  /** Zero-cost usage event + ledger row with reason setup_free. */
  logFreeSetup(userId: string, agentType: string, opts: SpendOptions): Promise<SpendReceipt>;
  /** Idempotent: returns false when the event was not in 'ok' status. */
  refund(eventId: string): Promise<boolean>;
  now(): Date;
}

export interface CreditTicket {
  eventId: string | null;
  credits: number;
  /** True when this action was free setup (nothing to give back, only mark failed). */
  free: boolean;
  /** True once a refund was issued through this ticket. */
  refunded: boolean;
  /** Refund once. Never throws; a second call is a no-op. */
  refund(): Promise<boolean>;
}

function makeTicket(receipt: SpendReceipt, free: boolean, ports: Pick<SpendPorts, "refund">, onRefundError: (e: unknown) => void): CreditTicket {
  let done = false;
  const ticket: CreditTicket = {
    eventId: receipt.eventId,
    credits: receipt.credits,
    free,
    get refunded() {
      return done;
    },
    async refund() {
      if (done || !receipt.eventId) return false;
      done = true;
      try {
        await ports.refund(receipt.eventId);
        return true;
      } catch (err) {
        // A failed refund must never mask the original failure.
        onRefundError(err);
        return false;
      }
    },
  };
  return ticket;
}

/**
 * Charge for one action, unless it is a free first-project setup action.
 * The setup decision is made here, on the server, from DB facts. With billing
 * disabled the legacy path runs unchanged (full-cost metering, never blocks).
 */
export async function spendOrFreeSetup(
  ports: SpendPorts,
  userId: string,
  agentType: string,
  opts: SpendOptions = {},
  onRefundError: (e: unknown) => void = () => {}
): Promise<CreditTicket> {
  if (opts.projectId && isSetupFreeAgentType(agentType) && (await ports.billingEnabled())) {
    const facts = await ports.setupFacts(userId, opts.projectId, agentType).catch(() => null);
    if (facts && isSetupFree(agentType, facts, ports.now())) {
      const receipt = await ports.logFreeSetup(userId, agentType, opts);
      return makeTicket(receipt, true, ports, onRefundError);
    }
  }
  const receipt = await ports.charge(userId, agentType, opts);
  return makeTicket(receipt, false, ports, onRefundError);
}

/**
 * Run the work; if it throws or returns a failed result, refund the ticket.
 * The original error/result is always passed through. A null ticket (BYOK,
 * self-host) just runs the work.
 */
export async function withRefund<T>(
  ticket: CreditTicket | null | undefined,
  work: () => Promise<T>,
  isFailure: (result: T) => boolean = () => false
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (err) {
    await ticket?.refund();
    throw err;
  }
  if (ticket && isFailure(result)) await ticket.refund();
  return result;
}

/** HTTP-style failure test for routes that return a Response. */
export function isFailedResponse(res: { status: number }): boolean {
  return res.status >= 400;
}
