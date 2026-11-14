import type Database from "better-sqlite3";
import {
  hashOwnerToken,
  isExpired,
  toPublicReport,
  type PublicReport,
  type PublicReportStore,
  type ReportFinding,
  type StoredReport,
} from "./publicReport.ts";

/** The slice of the Supabase client used here (service role). Structurally matches SupabaseClient. */
type Result<T> = PromiseLike<{ data: T; error: { message: string } | null }>;
export type ReportsClient = {
  from(table: "public_audit_reports"): {
    insert(row: Record<string, unknown>): Result<unknown>;
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): Result<Record<string, unknown> | null> };
    };
    delete(): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { select(columns: string): Result<Array<{ id: string }> | null> };
      };
    };
  };
};

function parseSummary(value: unknown): PublicReport["summary"] {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return { totalFindings: n(v.totalFindings), critical: n(v.critical), warnings: n(v.warnings) };
}

function fromRow(row: Record<string, unknown>): PublicReport {
  return {
    id: String(row.id),
    url: String(row.url),
    host: String(row.host),
    score: Number(row.score),
    summary: parseSummary(row.summary),
    findings: Array.isArray(row.findings) ? (row.findings as ReportFinding[]) : [],
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
  };
}

/** Hosted store. A failed query throws, so the caller can decide to skip saving instead of pretending it saved. */
export function supabaseReportStore(client: ReportsClient): PublicReportStore {
  return {
    async save(report: StoredReport) {
      const { error } = await client.from("public_audit_reports").insert({
        id: report.id,
        url: report.url,
        host: report.host,
        score: report.score,
        summary: report.summary,
        findings: report.findings,
        owner_token_hash: report.ownerTokenHash,
        created_at: report.createdAt,
        expires_at: report.expiresAt,
      });
      if (error) throw new Error(`report save failed: ${error.message}`);
    },
    async get(id, now = new Date()) {
      const { data, error } = await client
        .from("public_audit_reports")
        .select("id,url,host,score,summary,findings,created_at,expires_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`report read failed: ${error.message}`);
      if (!data) return null;
      const report = fromRow(data);
      return isExpired(report, now) ? null : report;
    },
    async remove(id, ownerToken) {
      const { data, error } = await client
        .from("public_audit_reports")
        .delete()
        .eq("id", id)
        .eq("owner_token_hash", hashOwnerToken(ownerToken))
        .select("id");
      if (error) throw new Error(`report remove failed: ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
  };
}

/** Self-host store (local SQLite). The table is created in lib/db.ts. */
export function sqliteReportStore(db: Database.Database): PublicReportStore {
  return {
    async save(report) {
      db.prepare(
        `INSERT INTO public_audit_reports (id, url, host, score, summary, findings, owner_token_hash, created_at, expires_at)
         VALUES (@id, @url, @host, @score, @summary, @findings, @hash, @created_at, @expires_at)`,
      ).run({
        id: report.id,
        url: report.url,
        host: report.host,
        score: report.score,
        summary: JSON.stringify(report.summary),
        findings: JSON.stringify(report.findings),
        hash: report.ownerTokenHash,
        created_at: report.createdAt,
        expires_at: report.expiresAt,
      });
    },
    async get(id, now = new Date()) {
      const row = db
        .prepare(`SELECT id, url, host, score, summary, findings, created_at, expires_at FROM public_audit_reports WHERE id = ?`)
        .get(id) as Record<string, unknown> | undefined;
      if (!row) return null;
      let summary: unknown = {};
      let findings: unknown = [];
      try {
        summary = JSON.parse(String(row.summary));
        findings = JSON.parse(String(row.findings));
      } catch {
        return null;
      }
      const report = fromRow({ ...row, summary, findings });
      return isExpired(report, now) ? null : toPublicReport({ ...report, ownerTokenHash: "" });
    },
    async remove(id, ownerToken) {
      const res = db
        .prepare(`DELETE FROM public_audit_reports WHERE id = ? AND owner_token_hash = ?`)
        .run(id, hashOwnerToken(ownerToken));
      return res.changes > 0;
    },
  };
}
