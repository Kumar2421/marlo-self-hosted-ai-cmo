import assert from "node:assert/strict";
import test from "node:test";
import { buildStoredReport } from "../lib/domain/seo/publicReport.ts";
import { supabaseReportStore, type ReportsClient } from "../lib/domain/seo/publicReportStores.ts";

// What comes back out of the database goes onto a public page, so malformed saved posts must read as "none".

function clientWith(row: Record<string, unknown>): ReportsClient {
  const ok = <T,>(data: T) => Promise.resolve({ data, error: null });
  return {
    from: () => ({
      insert: () => ok(null),
      select: () => ({ eq: () => ({ maybeSingle: () => ok(row) }) }),
      update: () => ({ eq: () => ({ eq: () => ({ select: () => ok([]) }) }) }),
      delete: () => ({ eq: () => ({ eq: () => ({ select: () => ok([]) }) }) }),
    }),
  } as unknown as ReportsClient;
}

function rowWith(posts: unknown): Record<string, unknown> {
  const { report } = buildStoredReport({
    url: "https://acme.test/", score: 70, findings: [], summary: { totalFindings: 0, critical: 0, warnings: 0 },
  });
  return {
    id: report.id, url: report.url, host: report.host, score: report.score, summary: report.summary, findings: report.findings,
    leads: null, posts, created_at: report.createdAt, expires_at: report.expiresAt,
  };
}

test("malformed saved posts come back as null", async () => {
  const bad: unknown[] = [{ x: { text: 5 }, linkedin: "nope" }, { x: null, linkedin: null }, "string", 7, { x: {}, linkedin: { hookLine: "h" } }];
  for (const posts of bad) {
    const row = rowWith(posts);
    const got = await supabaseReportStore(clientWith(row)).get(String(row.id));
    assert.equal(got!.posts, null, JSON.stringify(posts));
  }
});

test("valid saved posts keep only the known fields", async () => {
  const row = rowWith({ x: { text: "hi", extra: "dropped" }, linkedin: null });
  const got = await supabaseReportStore(clientWith(row)).get(String(row.id));
  assert.deepEqual(got!.posts, { x: { text: "hi" }, linkedin: null });
});
