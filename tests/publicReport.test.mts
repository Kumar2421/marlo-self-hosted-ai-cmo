import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  REPORT_ID_LENGTH,
  REPORT_TTL_DAYS,
  buildStoredReport,
  hashOwnerToken,
  hostOf,
  isExpired,
  isOwnerTokenShape,
  isReportId,
  memoryReportStore,
  newReportId,
  reportPath,
  scoreBand,
  toPublicReport,
} from "../lib/domain/seo/publicReport.ts";
import { sqliteReportStore, supabaseReportStore, type ReportsClient } from "../lib/domain/seo/publicReportStores.ts";

const finding = (over: Record<string, unknown> = {}) => ({
  issueId: "meta-title-missing",
  category: "meta-title",
  severity: "Error" as const,
  label: "Missing page title",
  evidence: { title: "Home" } as Record<string, string | number | null>,
  whyItMatters: "Search results show the title.",
  recommendation: "Add a title.",
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  url: "https://www.example.com/",
  score: 62.4,
  findings: [finding(), finding({ issueId: "b" }), finding({ issueId: "c" }), finding({ issueId: "d" })],
  summary: { totalFindings: 7, critical: 2, warnings: 5 },
  ...over,
});

test("ids are 12 characters from a readable alphabet and unique", () => {
  const ids = new Set(Array.from({ length: 500 }, () => newReportId()));
  assert.equal(ids.size, 500);
  for (const id of ids) {
    assert.equal(id.length, REPORT_ID_LENGTH);
    assert.ok(isReportId(id));
    assert.ok(!/[01oOiIlL]/.test(id), id);
  }
});

test("isReportId rejects anything that is not an id", () => {
  for (const bad of ["", "short", "A".repeat(12), "abc def ghij", "../../etc/pass", "a".repeat(13), null, 5, "2222222222o2"]) {
    assert.equal(isReportId(bad as unknown), false, String(bad));
  }
});

test("owner tokens are url-safe and only their hash is kept", () => {
  const { report, ownerToken } = buildStoredReport(input());
  assert.ok(isOwnerTokenShape(ownerToken));
  assert.equal(report.ownerTokenHash, hashOwnerToken(ownerToken));
  assert.notEqual(report.ownerTokenHash, ownerToken);
  assert.ok(!JSON.stringify(toPublicReport(report)).includes(report.ownerTokenHash));
  assert.equal(isOwnerTokenShape("short"), false);
  assert.equal(isOwnerTokenShape("has space has space has space"), false);
});

test("score bands use plain words", () => {
  assert.equal(scoreBand(95).label, "Strong");
  assert.equal(scoreBand(90).band, "strong");
  assert.equal(scoreBand(75).label, "Good");
  assert.equal(scoreBand(50).label, "Needs work");
  assert.equal(scoreBand(49).label, "Weak");
  assert.equal(scoreBand(0).band, "weak");
});

test("a stored report keeps three findings, a whole-number score and the host", () => {
  const { report } = buildStoredReport(input());
  assert.equal(report.findings.length, 3);
  assert.equal(report.score, 62);
  assert.equal(report.host, "example.com");
  assert.equal(reportPath(report.id), `/audit/r/${report.id}`);
});

test("hostile or oversized text is capped and bad scores are clamped", () => {
  const huge = "x".repeat(5000);
  const { report } = buildStoredReport(
    input({
      url: `https://example.com/${huge}`,
      score: 9999,
      findings: [finding({ label: huge, whyItMatters: huge, recommendation: huge, evidence: { a: huge, b: 1, c: null, d: { nested: true } } })],
    }),
  );
  assert.equal(report.score, 100);
  assert.ok(report.url.length <= 500);
  assert.ok(report.findings[0].label.length <= 200);
  assert.ok(report.findings[0].whyItMatters.length <= 600);
  assert.ok(report.findings[0].recommendation.length <= 600);
  assert.ok(String(report.findings[0].evidence.a).length <= 200);
  assert.equal(report.findings[0].evidence.b, 1);
  assert.equal(report.findings[0].evidence.c, null);
  assert.equal("d" in report.findings[0].evidence, false, "nested values are dropped");
  assert.equal(buildStoredReport(input({ score: Number.NaN })).report.score, 0);
  assert.equal(buildStoredReport(input({ score: -4 })).report.score, 0);
});

test("a report expires after the retention period", () => {
  const now = new Date("2026-11-14T00:00:00Z");
  const { report } = buildStoredReport(input(), now);
  assert.equal(Date.parse(report.expiresAt) - now.getTime(), REPORT_TTL_DAYS * 24 * 3600 * 1000);
  assert.equal(isExpired(report, new Date(now.getTime() + 89 * 24 * 3600 * 1000)), false);
  assert.equal(isExpired(report, new Date(now.getTime() + 91 * 24 * 3600 * 1000)), true);
  assert.equal(isExpired({ expiresAt: "not a date" }), true);
});

test("hostOf drops www and survives junk", () => {
  assert.equal(hostOf("https://www.Example.com/a?b=1"), "example.com");
  assert.equal(hostOf("not a url"), "not a url");
});

async function storeContract(make: () => ReturnType<typeof memoryReportStore>) {
  const store = make();
  const { report, ownerToken } = buildStoredReport(input());
  await store.save(report);

  const got = await store.get(report.id);
  assert.ok(got);
  assert.equal(got.host, "example.com");
  assert.equal(got.score, 62);
  assert.equal(got.findings.length, 3);
  assert.equal("ownerTokenHash" in got, false, "the token hash never leaves the store");

  assert.equal(await store.get("zzzzzzzzzzzz"), null);
  assert.equal(await store.remove(report.id, "wrong-token-wrong-token-wrong"), false);
  assert.ok(await store.get(report.id), "a wrong token removes nothing");
  assert.equal(await store.remove(report.id, ownerToken), true);
  assert.equal(await store.get(report.id), null);
  assert.equal(await store.remove(report.id, ownerToken), false, "removing twice is a no-op");

  const old = buildStoredReport(input(), new Date("2026-01-01T00:00:00Z"));
  await store.save(old.report);
  assert.equal(await store.get(old.report.id, new Date("2026-11-14T00:00:00Z")), null, "an expired report is not served");
}

test("memory store follows the contract", async () => {
  await storeContract(memoryReportStore);
});

test("sqlite store follows the contract", async () => {
  await storeContract(() => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE public_audit_reports (id TEXT PRIMARY KEY, url TEXT NOT NULL, host TEXT NOT NULL, score INTEGER NOT NULL,
      summary TEXT NOT NULL, findings TEXT NOT NULL, owner_token_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
    return sqliteReportStore(db);
  });
});

function fakeSupabase(): { client: ReportsClient; rows: Map<string, Record<string, unknown>>; failNext: { on: boolean } } {
  const rows = new Map<string, Record<string, unknown>>();
  const failNext = { on: false };
  const result = <T,>(data: T) => {
    if (failNext.on) return Promise.resolve({ data: null as T, error: { message: "boom" } });
    return Promise.resolve({ data, error: null });
  };
  const client: ReportsClient = {
    from: () => ({
      insert: (row) => {
        if (!failNext.on) rows.set(String(row.id), row);
        return result(null);
      },
      select: () => ({ eq: (_c, v) => ({ maybeSingle: () => result(rows.get(v) ?? null) }) }),
      delete: () => ({
        eq: (_c, id) => ({
          eq: (_c2, hash) => ({
            select: () => {
              const row = rows.get(id);
              if (row && row.owner_token_hash === hash) {
                rows.delete(id);
                return result([{ id }]);
              }
              return result([]);
            },
          }),
        }),
      }),
    }),
  };
  return { client, rows, failNext };
}

test("supabase store follows the contract", async () => {
  await storeContract(() => supabaseReportStore(fakeSupabase().client));
});

test("supabase store writes the hash column, not the token, and reports failures instead of hiding them", async () => {
  const { client, rows, failNext } = fakeSupabase();
  const store = supabaseReportStore(client);
  const { report, ownerToken } = buildStoredReport(input());
  await store.save(report);
  const row = rows.get(report.id)!;
  assert.equal(row.owner_token_hash, hashOwnerToken(ownerToken));
  assert.ok(!JSON.stringify(row).includes(ownerToken));

  failNext.on = true;
  await assert.rejects(() => store.save(buildStoredReport(input()).report), /report save failed/);
  await assert.rejects(() => store.get(report.id), /report read failed/);
  await assert.rejects(() => store.remove(report.id, ownerToken), /report remove failed/);
});
