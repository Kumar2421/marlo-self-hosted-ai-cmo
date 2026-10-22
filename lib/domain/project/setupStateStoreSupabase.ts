import type { SupabaseClient } from "@supabase/supabase-js";
import { docKeyOfType, normalizeSetupState, type SetupFacts, type SetupState } from "./setupState.ts";
import type { SetupStateStore } from "./setupStateService.ts";

// Platform (Supabase) store; every query is scoped by user and project explicitly.
// Writes use the service client (the table's RLS only lets owners read).

export function supabaseSetupStateStore(db: SupabaseClient, userId: string, projectId: string): SetupStateStore {
  return {
    async load() {
      const { data, error } = await db
        .from("project_setup_state")
        .select("steps, started_at, finished_at, updated_at")
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return normalizeSetupState(
        { steps: data.steps, startedAt: data.started_at, finishedAt: data.finished_at, updatedAt: data.updated_at },
        new Date(),
      );
    },

    async saveIfUnchanged(state: SetupState, expectedUpdatedAt: string | null) {
      const fields = {
        steps: state.steps,
        started_at: state.startedAt,
        finished_at: state.finishedAt,
        updated_at: state.updatedAt,
      };
      if (expectedUpdatedAt === null) {
        const { error } = await db
          .from("project_setup_state")
          .insert({ project_id: projectId, user_id: userId, ...fields });
        if (!error) return true;
        if ((error as { code?: string }).code === "23505") return false; // lost the insert race
        throw new Error(error.message);
      }
      const { data, error } = await db
        .from("project_setup_state")
        .update(fields)
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .eq("updated_at", expectedUpdatedAt)
        .select("project_id");
      if (error) throw new Error(error.message);
      return (data ?? []).length === 1;
    },

    async facts(): Promise<SetupFacts> {
      const scoped = (table: string, cols: string) => db.from(table).select(cols).eq("user_id", userId).eq("project_id", projectId);
      const [proj, audits, comps, docs] = await Promise.all([
        db.from("projects").select("description").eq("owner_id", userId).eq("id", projectId).maybeSingle(),
        scoped("seo_audits", "id").limit(1),
        scoped("project_competitors", "id").limit(1),
        scoped("project_documents", "doc_type, content"),
      ]);
      const rows = (docs.data ?? []) as unknown as { doc_type: string; content: string | null }[];
      return {
        hasAudit: (audits.data ?? []).length > 0,
        hasDescription: Boolean((proj.data as { description?: string } | null)?.description?.trim()),
        hasCompetitors: (comps.data ?? []).length > 0,
        documents: rows
          .filter((r) => typeof r.content === "string" && r.content.trim())
          .map((r) => docKeyOfType(r.doc_type))
          .filter((k): k is NonNullable<typeof k> => k !== null),
      };
    },
  };
}
