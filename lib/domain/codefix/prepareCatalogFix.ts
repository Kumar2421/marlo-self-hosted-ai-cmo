import { canAffordCredits, type CreditState } from "../x/draftGuards.ts";

/**
 * Order of the codefix prepare step for a catalog finding: credit pre-check,
 * then the LLM proposal, then the charge. A zero-credit user never reaches the
 * model on the platform key, and a failed proposal is never charged. Pure, so
 * the ordering can be tested with fake ports; the route supplies the real ones.
 */

export const OUT_OF_CREDITS_MESSAGE = "Out of credits. Upgrade or connect your own key.";

export type CatalogPreparePorts<T> = {
  /** A user's own key is never metered: no pre-check and no charge (as the other agent routes do). */
  isByok: boolean;
  creditState(): Promise<CreditState>;
  /** Runs the model. A throw propagates and nothing is charged. */
  propose(): Promise<T>;
  /** Meters the call. Resolves false when the balance no longer covers it. */
  charge(): Promise<boolean>;
};

export type CatalogPrepareResult<T> =
  | { ok: true; proposal: T }
  | { ok: false; status: number; error: string };

export async function prepareCatalogFix<T>(ports: CatalogPreparePorts<T>): Promise<CatalogPrepareResult<T>> {
  if (!ports.isByok) {
    const state = await ports.creditState();
    if (!canAffordCredits(state)) return { ok: false, status: 402, error: OUT_OF_CREDITS_MESSAGE };
  }

  const proposal = await ports.propose();

  if (!ports.isByok) {
    const paid = await ports.charge();
    if (!paid) return { ok: false, status: 402, error: OUT_OF_CREDITS_MESSAGE };
  }
  return { ok: true, proposal };
}
