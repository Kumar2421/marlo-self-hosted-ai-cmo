import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { FEATURES } from "@/lib/features";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getDb } from "@/lib/db";

export type ProjectContext = {
  userId: string | null;
  projectId: string;
  project: Record<string, unknown>;
  supabase?: ReturnType<typeof createServiceClient>;
};

export async function getAuthenticatedProjectContext(
  requestedProjectId?: string | null
): Promise<{ context: ProjectContext } | { response: NextResponse }> {
  if (FEATURES.PLATFORM_MODE) {
    const authClient = await createClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
    }

    const db = createServiceClient();
    const projectColumns = "id, owner_id, name, category, description, url, created_at, updated_at";

    // Explicit project: one query, no need to read the saved active-project setting.
    // Otherwise read the setting and the owner's projects concurrently (one round
    // trip instead of two) and pick the active one locally.
    let project: { id: string } & Record<string, unknown> | null | undefined;
    let error: { message: string } | null = null;
    if (requestedProjectId) {
      const res = await db.from("projects").select(projectColumns).eq("owner_id", user.id).eq("id", requestedProjectId).maybeSingle();
      project = res.data;
      error = res.error;
    } else {
      const [settingRes, projectsRes] = await Promise.all([
        db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle(),
        db.from("projects").select(projectColumns).eq("owner_id", user.id),
      ]);
      const activeId = settingRes.data?.value ?? null;
      if (!activeId) {
        return { response: NextResponse.json({ error: "No active project" }, { status: 404 }) };
      }
      error = projectsRes.error;
      project = (projectsRes.data ?? []).find((p: { id: string }) => p.id === activeId);
    }
    if (error) return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
    if (!project) return { response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

    return { context: { userId: user.id, projectId: project.id, project, supabase: db } };
  }

  const db = getDb();
  const projectId = requestedProjectId ?? getActiveProjectId();
  if (!projectId) return { response: NextResponse.json({ error: "No active project" }, { status: 404 }) };
  const project = db.prepare("SELECT id, name, category, description, url, created_at, updated_at FROM projects WHERE id = ?").get(projectId) as Record<string, unknown> | undefined;
  if (!project) return { response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  return { context: { userId: null, projectId, project } };
}
