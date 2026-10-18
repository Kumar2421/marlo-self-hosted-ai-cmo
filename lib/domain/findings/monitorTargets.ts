import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllRows } from "./fixedFindingRows.ts";
import type { MonitorScope } from "./monitorAudit.ts";

export const MONITOR_MARKER = "monitor_audit";

/** Projects with a site URL, with the time of their last monitor pass (the marker row's updated_at). */
export async function monitorTargetsPlatform(db: SupabaseClient): Promise<MonitorScope[]> {
  const projects = await readAllRows<{ id: unknown; owner_id: unknown; url: unknown }>((from, to) =>
    db.from("projects").select("id, owner_id, url").not("url", "is", null).order("id", { ascending: true }).range(from, to),
  );
  const markers = await readAllRows<{ project_id: unknown; updated_at: unknown }>((from, to) =>
    db.from("project_documents").select("project_id, updated_at").eq("doc_type", MONITOR_MARKER).order("project_id", { ascending: true }).range(from, to),
  );
  const lastRun = new Map(markers.map((m) => [String(m.project_id), String(m.updated_at)]));
  return projects.map((p) => ({
    userId: String(p.owner_id),
    projectId: String(p.id),
    siteUrl: String(p.url),
    lastRunAt: lastRun.get(String(p.id)) ?? null,
  }));
}
