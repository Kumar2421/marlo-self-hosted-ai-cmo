/**
 * Pure, testable orchestration for draft generation across platforms.
 * Separated from route/server concerns for unit testing.
 */

export interface CreditState {
  billingEnabled: boolean;
  balance: number;
  cost: number;
}

export interface Reservation {
  ok: true;
  batchId: string;
}

export interface ReservationFailure {
  ok: false;
  used: number;
}

export class InsufficientCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

export interface DraftGenerationPorts {
  creditState(): Promise<CreditState>;
  reserveSlot(limit: number): Promise<Reservation | ReservationFailure>;
  releaseSlot(batchId: string): Promise<void>;
  callModel(): Promise<string>;
  parse(text: string): { drafts: unknown[]; errors?: unknown[] };
  filterUsable(drafts: unknown[]): unknown[];
  insertDrafts(batchId: string | null, drafts: unknown[]): Promise<unknown[]>;
  deleteBatch(batchId: string): Promise<void>;
  charge(): Promise<void>;
  isByok: boolean;
  limit: number;
}

export interface DraftGenerationResult {
  status: number;
  body: unknown;
}

export function canAffordCredits(state: CreditState): boolean {
  if (!state.billingEnabled) return true;
  return state.balance >= state.cost;
}

export async function generateDraftBatch(
  ports: DraftGenerationPorts,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  input: { variants: number }
): Promise<DraftGenerationResult> {
  let reservedBatchId: string | null = null;

  const release = async () => {
    if (reservedBatchId) {
      await ports.releaseSlot(reservedBatchId).catch(() => {});
      reservedBatchId = null;
    }
  };

  try {
    // Step 1: Check credit affordability (only if not BYOK)
    if (!ports.isByok) {
      const creditState = await ports.creditState();
      if (!canAffordCredits(creditState)) {
        return {
          status: 402,
          body: { error: "Out of credits. Upgrade or connect your own key." },
        };
      }

      // Step 2: Reserve slot (if limit != -1)
      if (ports.limit !== -1) {
        const slot = await ports.reserveSlot(ports.limit);
        if (!slot.ok) {
          return {
            status: 429,
            body: {
              error: `Daily limit reached (${ports.limit} batches). Try again tomorrow, or connect your own Groq key.`,
              limit: ports.limit,
            },
          };
        }
        reservedBatchId = slot.batchId;
      }
    }

    // Step 3: Call model
    let text: string;
    try {
      text = await ports.callModel();
    } catch (err) {
      await release();
      return {
        status: 502,
        body: {
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }

    // Step 4: Parse response
    const { drafts, errors } = ports.parse(text);

    // Step 5: Filter usable
    const usable = ports.filterUsable(drafts);
    if (usable.length === 0) {
      await release();
      return {
        status: 502,
        body: {
          error:
            "The model returned drafts we couldn't use. Nothing was charged; try again.",
          details: (errors ?? []).slice(0, 3),
        },
      };
    }

    // Step 6: Insert drafts
    let created: unknown[];
    try {
      created = await ports.insertDrafts(reservedBatchId, usable);
      reservedBatchId = null; // Placeholder is consumed; real drafts now hold the batch
    } catch (err) {
      await release();
      return {
        status: 500,
        body: {
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }

    // Step 7: Charge (if not BYOK)
    if (!ports.isByok) {
      try {
        await ports.charge();
      } catch (err) {
        // Delete the inserted drafts if charge fails
        const created_array = Array.isArray(created) ? created : [created];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batch = (created_array[0] as any)?.batchId;
        if (batch) {
          await ports.deleteBatch(batch).catch(() => {});
        }

        // Check if insufficient credits
        if (err instanceof InsufficientCreditsError) {
          return {
            status: 402,
            body: { error: "Out of credits. Upgrade or connect your own key." },
          };
        }

        // Other charge errors bubble up
        throw err;
      }
    }

    // Step 8: Success
    return {
      status: 201,
      body: { drafts: created },
    };
  } catch (err) {
    // Unexpected errors
    return {
      status: 500,
      body: {
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
