import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditSummary, GeoStatus, LeadSummary } from "./tools.ts";

/** Row shape the lead summary needs (both stores map into this). */
export type LeadRow = {
  name: string | null; title: string | null; company: string | null; location: string | null;
  lead_type: string | null; email: string | null; email_verified: boolean | number | null;
  emailed_at: string | null; last_reply_at: string | null; created_at: string;
};

/** Cap on rows read to compute counts. */
export const LEAD_SCAN_LIMIT = 2000;

/** Pure: counts + a short recent list. Raw email addresses never leave this function. */
export function summarizeLeads(rows: LeadRow[], recentLimit: number): LeadSummary {
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    total: rows.length,
    truncated: rows.length >= LEAD_SCAN_LIMIT,
    withEmail: rows.filter((r) => !!r.email).length,
    emailVerified: rows.filter((r) => !!r.email_verified).length,
    emailed: rows.filter((r) => !!r.emailed_at).length,
    replied: rows.filter((r) => !!r.last_reply_at).length,
    recent: sorted.slice(0, recentLimit).map((r) => ({
      name: r.name ?? "", title: r.title ?? "", company: r.company ?? "", location: r.location ?? "",
      leadType: r.lead_type ?? "person", hasEmail: !!r.email, emailVerified: !!r.email_verified,
      emailed: !!r.emailed_at, replied: !!r.last_reply_at, createdAt: r.created_at,
    })),
  };
}

const LEAD_COLUMNS = "name, title, company, location, lead_type, email, email_verified, emailed_at, last_reply_at, created_at";

export async function supabaseLeadSummary(db: SupabaseClient, userId: string, projectId: string, recentLimit: number): Promise<LeadSummary> {
  const { data, error } = await db
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(LEAD_SCAN_LIMIT);
  if (error) throw new Error(`Could not load leads: ${error.message}`);
  return summarizeLeads((data ?? []) as LeadRow[], recentLimit);
}

export async function supabaseGeoStatus(db: SupabaseClient, userId: string, projectId: string): Promise<GeoStatus> {
  const { data, error } = await db
    .from("geo_checks")
    .select("payload, checked_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(`Could not load GEO check: ${error.message}`);
  return geoFromRow(data ? { payload: data.payload, checked_at: String(data.checked_at) } : null);
}

type AuditLikePayload = {
  url?: string;
  meta?: { indexable?: boolean };
  issues?: Array<{ label?: unknown; level?: unknown }>;
  pageSpeed?: { mobile?: { performance: number; accessibility: number; bestPractices: number; seo: number } };
};

/** Pure: boil a stored SEO audit payload (JSON string or object) down to what chat may say. */
export function auditFromRow(row: { payload: unknown; created_at: string; url?: string } | null): AuditSummary {
  if (!row) return null;
  let p: unknown = row.payload;
  if (typeof p === "string") {
    try { p = JSON.parse(p); } catch { return null; }
  }
  if (!p || typeof p !== "object") return null;
  const a = p as AuditLikePayload;
  const issues = (Array.isArray(a.issues) ? a.issues : [])
    .filter((i) => typeof i?.label === "string")
    .map((i) => ({ label: (i.label as string).slice(0, 160), level: (i.level === "Error" ? "Error" : "Warning") as "Warning" | "Error" }));
  const errors = issues.filter((i) => i.level === "Error");
  const warnings = issues.filter((i) => i.level === "Warning");
  return {
    url: a.url ?? row.url ?? "",
    checkedAt: row.created_at,
    errors: errors.length,
    warnings: warnings.length,
    indexable: a.meta?.indexable !== false,
    topIssues: [...errors, ...warnings].slice(0, 10),
    scores: a.pageSpeed?.mobile ?? null,
  };
}

export async function supabaseAuditSummary(db: SupabaseClient, userId: string, projectId: string): Promise<AuditSummary> {
  const { data, error } = await db
    .from("seo_audits")
    .select("url, payload, created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load SEO audit: ${error.message}`);
  return auditFromRow(data ? { payload: data.payload, created_at: String(data.created_at), url: data.url } : null);
}

export async function supabaseCompetitors(db: SupabaseClient, userId: string, projectId: string): Promise<string[]> {
  const { data, error } = await db
    .from("project_competitors")
    .select("url")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`Could not load competitors: ${error.message}`);
  return (data ?? []).map((r) => String(r.url));
}

/** `payload` is a JSON string (SQLite) or already-parsed JSON (Postgres). */
export function geoFromRow(row: { payload: unknown; checked_at: string } | null): GeoStatus {
  if (!row) return null;
  let rows: unknown = row.payload;
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows); } catch { return null; }
  }
  if (!Array.isArray(rows)) return null;
  return {
    checkedAt: row.checked_at,
    rows: rows
      .filter((r): r is { query: string; found: boolean; matchedUrl?: string } => !!r && typeof r.query === "string")
      .map((r) => ({ query: r.query, found: !!r.found, matchedUrl: typeof r.matchedUrl === "string" ? r.matchedUrl : undefined })),
  };
}
