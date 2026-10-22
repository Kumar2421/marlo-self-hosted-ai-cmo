import test from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_DATASETS,
  mergeDashboardData,
  parseDatasetFilter,
  slimAuditRow,
  type DashboardData,
  type DashboardPatch,
} from "../lib/domain/project/dashboardCache.ts";
import { latestOnPageScore } from "../lib/domain/project/setupChecklist.ts";

const cached = (): DashboardData => ({
  project: { id: "p1", name: "Old" },
  projectId: "p1",
  data: {
    project_documents: [{ doc_type: "product_info", content: "old" }],
    project_competitors: [{ id: "c1", url: "a.com" }],
    seo_audits: [{ url: "https://x.com" }],
  },
});

test("parseDatasetFilter: absent or empty means every dataset", () => {
  assert.deepEqual(parseDatasetFilter(null), [...DASHBOARD_DATASETS]);
  assert.deepEqual(parseDatasetFilter(""), [...DASHBOARD_DATASETS]);
  assert.deepEqual(parseDatasetFilter(" , "), [...DASHBOARD_DATASETS]);
});

test("parseDatasetFilter: keeps known names once, in canonical order", () => {
  assert.deepEqual(parseDatasetFilter("seo_audits,project_documents,seo_audits"), ["project_documents", "seo_audits"]);
});

test("parseDatasetFilter: an unknown or removed dataset is rejected", () => {
  assert.equal(parseDatasetFilter("leads"), null);
  assert.equal(parseDatasetFilter("project_documents,findings"), null);
});

test("mergeDashboardData replaces only the datasets in the patch", () => {
  const prev = cached();
  const patch: DashboardPatch = {
    project: { id: "p1", name: "New" },
    projectId: "p1",
    data: { project_documents: [{ doc_type: "product_info", content: "new" }] },
  };
  const next = mergeDashboardData(prev, patch) as DashboardData;
  assert.deepEqual(next.data.project_documents, [{ doc_type: "product_info", content: "new" }]);
  assert.equal(next.data.project_competitors, prev.data.project_competitors);
  assert.equal(next.data.seo_audits, prev.data.seo_audits);
  assert.deepEqual(next.project, { id: "p1", name: "New" });
  assert.equal(prev.data.project_documents[0].content, "old", "cached value is not mutated");
});

test("mergeDashboardData ignores a late patch for another project or an empty cache", () => {
  const patch: DashboardPatch = { project: {}, projectId: "p2", data: { project_documents: [] } };
  const prev = cached();
  assert.equal(mergeDashboardData(prev, patch), prev);
  assert.equal(mergeDashboardData(undefined, { ...patch, projectId: "p1" }), undefined);
});

test("slimAuditRow keeps only url, created_at and a score the checklist can read", () => {
  const slim = slimAuditRow({ url: "https://x.com", created_at: "2026-01-01", onPageScore: 77.6 });
  assert.deepEqual(slim, { url: "https://x.com", created_at: "2026-01-01", payload: { technical: { onPageScore: 77.6 } } });
  assert.equal(latestOnPageScore([slim], "x.com"), 78);
});

test("slimAuditRow extracts the score from a full payload (object or JSON string) and drops the rest", () => {
  const full = { technical: { onPageScore: 64 }, bodyText: "x".repeat(10_000) };
  for (const payload of [full, JSON.stringify(full)]) {
    const slim = slimAuditRow({ url: "u", created_at: "t", payload });
    assert.deepEqual(slim, { url: "u", created_at: "t", payload: { technical: { onPageScore: 64 } } });
  }
});

test("slimAuditRow yields no score for a missing, null or garbage value", () => {
  const rows = [
    { url: "u", created_at: "t" },
    { url: "u", created_at: "t", onPageScore: null },
    { url: "u", created_at: "t", payload: "{nope" },
  ];
  for (const row of rows) {
    const slim = slimAuditRow(row);
    assert.equal(latestOnPageScore([slim]), null);
    assert.equal(slim.payload, null);
  }
});
