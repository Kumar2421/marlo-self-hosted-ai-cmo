import { getDb } from "@/lib/db";
import { sqliteSetupStateStore } from "./setupStateStore";
import { supabaseSetupStateStore } from "./setupStateStoreSupabase";
import type { SetupStateStore } from "./setupStateService";

/** The right store for an already ownership-checked project context (hosted: Supabase, self-host: SQLite). */
export function setupStoreFor(ctx: { userId: string | null; projectId: string; supabase?: unknown }): SetupStateStore {
  if (ctx.supabase && ctx.userId) {
    return supabaseSetupStateStore(ctx.supabase as Parameters<typeof supabaseSetupStateStore>[0], ctx.userId, ctx.projectId);
  }
  return sqliteSetupStateStore(getDb(), ctx.projectId);
}

