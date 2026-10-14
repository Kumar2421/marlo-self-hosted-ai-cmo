import type { SupabaseClient } from "@supabase/supabase-js";
import { NO_PROJECT_CONTEXT, type ProjectContext } from "./ProjectContext";

/** Project context for one project the user owns; null when it is not theirs or does not exist. */
export async function getProjectContextSupabaseById(
  db: SupabaseClient,
  userId: string,
  projectId: string
): Promise<ProjectContext | null> {
  const { data: project } = await db
    .from("projects")
    .select("name, category, description")
    .eq("id", projectId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!project) return null;

  const { data: docs } = await db
    .from("project_documents")
    .select("doc_type, content")
    .eq("project_id", projectId)
    .in("doc_type", ["product_info", "marketing_strategy", "competitor_analysis"]);

  const productInfo = docs?.find((d) => d.doc_type === "product_info")?.content || undefined;
  const marketingStrategy = docs?.find((d) => d.doc_type === "marketing_strategy")?.content || undefined;
  const competitorAnalysis = docs?.find((d) => d.doc_type === "competitor_analysis")?.content || undefined;

  return {
    name: project.name,
    category: project.category,
    description: project.description,
    productInfo,
    marketingStrategy,
    competitorAnalysis,
  };
}

/** Supabase equivalent of getActiveProjectContext() (lib/domain/shared/getActiveProject.ts),
 * scoped to one authenticated user instead of the shared local SQLite file. */
export async function getActiveProjectContextSupabase(
  db: SupabaseClient,
  userId: string
): Promise<ProjectContext> {
  const { data: setting } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "active_project_id")
    .maybeSingle();

  const activeId = setting?.value;
  if (!activeId) return NO_PROJECT_CONTEXT;

  return (await getProjectContextSupabaseById(db, userId, String(activeId))) ?? NO_PROJECT_CONTEXT;
}
