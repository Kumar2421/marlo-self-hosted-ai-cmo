import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGeoChecks, normalizeOverview, normalizeReferral, normalizeRuns } from "../components/dashboard/geo/normalizeGeo.ts";

test("normalizeGeoChecks turns missing or error-shaped data into an empty list", () => {
  for (const bad of [undefined, null, {}, { error: "boom" }, "x", 5, { checks: "nope" }, { checks: null }]) {
    const r = normalizeGeoChecks(bad);
    assert.deepEqual(r.checks, []);
    assert.equal(r.score, 0);
    assert.equal(r.domain, "");
  }
});

test("normalizeGeoChecks keeps good checks and repairs partial ones", () => {
  const r = normalizeGeoChecks({
    domain: "acme.test",
    score: 70,
    checks: [{ id: "a", label: "A", status: "pass", detail: "ok", fix: "" }, { id: "b", status: "weird" }, { label: "no id" }, null, 3],
  });
  assert.equal(r.domain, "acme.test");
  assert.equal(r.score, 70);
  assert.deepEqual(r.checks.map((c) => [c.id, c.label, c.status]), [["a", "A", "pass"], ["b", "b", "unknown"]]);
  assert.equal(r.checks[1].detail, "");
});

test("normalizeReferral defaults total and bySource", () => {
  assert.deepEqual(normalizeReferral(undefined), { total: 0, bySource: [] });
  assert.deepEqual(normalizeReferral({ total: "x", bySource: 4 }), { total: 0, bySource: [] });
  assert.deepEqual(normalizeReferral({ total: 3, bySource: [{ source: "chatgpt", sessions: 2 }, null] }), {
    total: 3,
    bySource: [{ source: "chatgpt", sessions: 2 }, { source: "", sessions: 0 }],
  });
});

test("normalizeRuns returns [] unless runs is an array and defaults competitors", () => {
  assert.deepEqual(normalizeRuns({}), []);
  assert.deepEqual(normalizeRuns(null), []);
  assert.deepEqual(normalizeRuns({ runs: "x" }), []);
  const runs = normalizeRuns({ runs: [{ mentioned: true }, null] });
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].competitors, []);
});

test("normalizeOverview survives {} and partial prompts", () => {
  const empty = normalizeOverview({});
  assert.deepEqual(empty.prompts, []);
  assert.equal(empty.lastRunAt, null);
  assert.equal(empty.capabilities, null);
  const o = normalizeOverview({ prompts: [{ prompt: "q" }, { nope: 1 }, { prompt: "r", active: false, methods: [{ method: "simulated" }] }] });
  assert.equal(o.prompts.length, 2);
  assert.equal(o.prompts[0].active, true);
  assert.deepEqual(o.prompts[0].methods, []);
  assert.equal(o.prompts[1].active, false);
  assert.deepEqual(o.prompts[1].methods[0].competitors, []);
  assert.equal(o.prompts[1].methods[0].runs, 0);
});
