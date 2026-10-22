import {
  applyTransition,
  deriveSetupState,
  newSetupState,
  type SetupFacts,
  type SetupState,
  type Transition,
} from "./setupState.ts";

/** Storage seam shared by the SQLite and Supabase stores (see setupStateStore*.ts). */
export type SetupStateStore = {
  load(): Promise<SetupState | null>;
  /** Compare-and-set on updated_at: inserts when `expectedUpdatedAt` is null (fails if a row exists),
   * otherwise updates only a row still carrying that updated_at. Returns false on a lost race. */
  saveIfUnchanged(state: SetupState, expectedUpdatedAt: string | null): Promise<boolean>;
  facts(): Promise<SetupFacts>;
};

/** Stored state, or one derived from existing rows and written lazily (a project with
 * complete documents counts as done). A lost write race re-reads the winner's row. */
export async function getOrCreateSetupState(store: SetupStateStore, now = new Date()): Promise<SetupState> {
  const existing = await store.load();
  if (existing) return existing;
  const derived = deriveSetupState(await store.facts(), now);
  if (await store.saveIfUnchanged(derived, null)) return derived;
  return (await store.load()) ?? derived;
}

/** Creates the "pending, started" row for a brand-new project (idempotent). */
export async function startSetupState(store: SetupStateStore, now = new Date()): Promise<void> {
  if (await store.load()) return;
  await store.saveIfUnchanged(newSetupState(now, true), null);
}

export type RecordResult =
  | { ok: true; state: SetupState }
  | { ok: false; reason: "conflict" | "invalid" | "busy"; message: string };

/** Validates and persists one step transition, retrying when another writer got in between. */
export async function recordSetupTransition(store: SetupStateStore, t: Transition, now = new Date()): Promise<RecordResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await getOrCreateSetupState(store, now);
    const res = applyTransition(current, t, now);
    if (!res.ok) return res;
    if (res.state === current) return { ok: true, state: current }; // idempotent no-op
    if (await store.saveIfUnchanged(res.state, current.updatedAt)) return { ok: true, state: res.state };
  }
  return { ok: false, reason: "busy", message: "Setup state is being updated elsewhere; try again." };
}
