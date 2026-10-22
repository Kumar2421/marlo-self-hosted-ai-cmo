import test from "node:test";
import assert from "node:assert/strict";
import { DOC_TYPES, REAL_DOCUMENT_TYPES } from "../lib/document-types.ts";
import { DATASETS, loadPlatformDatasets, type DatasetClient } from "../lib/domain/project/dashboardData.ts";
import { ALL_MARKER_EXACT, ALL_MARKER_PREFIXES, DATED_MARKER_PREFIXES, isPrunableMarker, pruneOldMarkers } from "../lib/domain/project/markerRetention.ts";

const MARKER_SAMPLES = [
  "social_daily_attempt:2026-10-14:x",
  "social_daily_done:2026-10-14:linkedin",
  "social_daily_claim:2026-10-14",
  "auto_propose_done:2026-10-14",
  "auto_propose_claim:2026-10-14",
  "auto_verify:finding-123",
  "monitor_audit",
  // settings rows share the table too and are not documents
  "automation_settings",
  "reddit_settings",
  "social_daily_settings",
];

test("every real DocKey is in the dashboard allowlist", () => {
  for (const d of DOC_TYPES) assert.ok(REAL_DOCUMENT_TYPES.includes(d.docType), d.docType);
  assert.ok(REAL_DOCUMENT_TYPES.includes("competitor_comparison"));
  assert.ok(REAL_DOCUMENT_TYPES.includes("lead_profile"));
  assert.deepEqual(DATASETS.project_documents.docTypes, REAL_DOCUMENT_TYPES);
});

test("no marker or settings doc_type is in the allowlist", () => {
  for (const m of MARKER_SAMPLES) assert.ok(!REAL_DOCUMENT_TYPES.includes(m), m);
  for (const p of ALL_MARKER_PREFIXES) assert.ok(!REAL_DOCUMENT_TYPES.some((t) => t.startsWith(p)), p);
  for (const e of ALL_MARKER_EXACT) assert.ok(!REAL_DOCUMENT_TYPES.includes(e), e);
});

test("the documents query filters by the allowlist before the limit", async () => {
  let seen: { col?: string; vals?: readonly string[] } = {};
  const filterable = {
    in(col: string, vals: readonly string[]) {
      seen = { col, vals };
      return filterable;
    },
    order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
  };
  const client = { from: () => ({ select: () => ({ eq: () => filterable }) }) } as unknown as DatasetClient;
  await loadPlatformDatasets(client, "p1", ["project_documents"]);
  assert.equal(seen.col, "doc_type");
  assert.deepEqual(seen.vals, REAL_DOCUMENT_TYPES);
});

test("only dated markers are prunable, never real documents", () => {
  for (const d of REAL_DOCUMENT_TYPES) assert.equal(isPrunableMarker(d), false);
  for (const s of ["automation_settings", "monitor_audit", "auto_verify:f1", "social_daily_settings"]) assert.equal(isPrunableMarker(s), false);
  for (const p of DATED_MARKER_PREFIXES) assert.equal(isPrunableMarker(`${p}2026-01-01`), true);
});

type Row = { project_id: string; doc_type: string; created_at: string };

/** Fake of the project_documents calls pruneOldMarkers makes; the or-filter is honoured via like-prefixes. */
function fakeDb(rows: Row[]) {
  const table = { rows };
  const db = {
    from() {
      return {
        select() {
          let orFilter = "";
          let cutoff = "";
          const q = {
            or(f: string) { orFilter = f; return q; },
            lt(_c: string, v: string) { cutoff = v; return q; },
            limit(n: number) {
              const prefixes = orFilter.split(",").map((x) => x.replace(/^doc_type\.like\./, "").replace(/\*$/, ""));
              const data = table.rows.filter((r) => prefixes.some((p) => r.doc_type.startsWith(p)) && r.created_at < cutoff).slice(0, n);
              return Promise.resolve({ data, error: null });
            },
          };
          return q;
        },
        delete() {
          let project = "";
          let types: string[] = [];
          let cutoff = "";
          const q: PromiseLike<{ error: null }> & Record<string, unknown> = {
            eq(_c: string, v: string) { project = v; return q; },
            in(_c: string, v: string[]) { types = v; return q; },
            lt(_c: string, v: string) { cutoff = v; return q; },
            then(res: (v: { error: null }) => unknown) {
              table.rows = table.rows.filter((r) => !(r.project_id === project && types.includes(r.doc_type) && r.created_at < cutoff));
              return Promise.resolve({ error: null }).then(res);
            },
          } as never;
          return q;
        },
      };
    },
  };
  return { db: db as never, table };
}

test("pruneOldMarkers deletes markers older than 30 days only, keeps real docs and recent markers, and is idempotent", async () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const old = "2026-08-01T00:00:00Z";
  const recent = "2026-10-20T00:00:00Z";
  const rows: Row[] = [
    ...REAL_DOCUMENT_TYPES.map((t) => ({ project_id: "p1", doc_type: t, created_at: old })),
    { project_id: "p1", doc_type: "automation_settings", created_at: old },
    { project_id: "p1", doc_type: "monitor_audit", created_at: old },
    { project_id: "p1", doc_type: "auto_verify:f1", created_at: old },
    { project_id: "p1", doc_type: "auto_propose_done:2026-08-01", created_at: old },
    { project_id: "p1", doc_type: "social_daily_attempt:2026-08-01:x", created_at: old },
    { project_id: "p2", doc_type: "social_daily_done:2026-08-01:x", created_at: old },
    { project_id: "p1", doc_type: "auto_propose_done:2026-10-20", created_at: recent },
  ];
  const { db, table } = fakeDb(rows);
  const first = await pruneOldMarkers(db, now, { budgetMs: 5000 });
  assert.equal(first.deleted, 3);
  const left = table.rows.map((r) => r.doc_type);
  for (const t of REAL_DOCUMENT_TYPES) assert.ok(left.includes(t));
  for (const t of ["automation_settings", "monitor_audit", "auto_verify:f1", "auto_propose_done:2026-10-20"]) assert.ok(left.includes(t), t);
  assert.ok(!left.some((t) => t.startsWith("social_daily_") || t === "auto_propose_done:2026-08-01"));
  const second = await pruneOldMarkers(db, now, { budgetMs: 5000 });
  assert.equal(second.deleted, 0);
});
