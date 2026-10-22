import assert from "node:assert/strict";
import test from "node:test";
import type { FindingRepository } from "../lib/domain/findings/findingService.ts";
import { canTransitionFinding, staleFindingError, type Finding } from "../lib/domain/findings/findingTypes.ts";
import { verifyFinding } from "../lib/domain/findings/verifyFinding.ts";
import { deriveGeoGapFindings, geoGapEntityId, geoGapVerdict } from "../lib/domain/geo/geoGaps.ts";
import { syncGeoGapFindings, type GapSyncPorts, type UpsertGapFinding } from "../lib/domain/geo/geoGapSync.ts";
import type { GeoRunRow } from "../lib/domain/geo/types.ts";
import { catalogEntry } from "../lib/domain/recommendations/issueRecommendations.ts";

const project = { name: "Acme", domain: "acme.com" };
const PROMPT = "What is the best CRM for a small team?";

let n = 0;
function run(over: Partial<GeoRunRow> & { day?: number } = {}): GeoRunRow {
  n++;
  const { day, ...rest } = over;
  return {
    prompt: PROMPT,
    engine: "Gemini with Google Search",
    method: "gemini-grounded",
    runAt: new Date(Date.UTC(2026, 9, day ?? 1, 10, n)).toISOString(),
    mentioned: false,
    cited: false,
    competitors: [],
    sources: [],
    answerExcerpt: "",
    ...rest,
  };
}
const derive = (runs: GeoRunRow[], opts = {}) => deriveGeoGapFindings(runs, [PROMPT], project, opts);

test("no gap when the project is mentioned", () => {
  assert.equal(derive([run({ mentioned: true }), run({ mentioned: true }), run({ mentioned: true })]).length, 0);
});

test("no runs at all is not measured, not a gap", () => {
  assert.equal(derive([]).length, 0);
});

test("a single run that misses is a gap", () => {
  assert.equal(derive([run()]).length, 1);
});

test("gap when not mentioned in 2 of the last 3 runs", () => {
  const gaps = derive([run({ day: 1, mentioned: true }), run({ day: 2 }), run({ day: 3 })]);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0].evidence.runs, { considered: 3, notMentioned: 2, mentioned: 1 });
});

test("table: threshold and recency cases", () => {
  // mentioned flags, oldest first
  const cases: Array<[string, boolean[], number]> = [
    ["1 miss of 3", [true, true, false], 0],
    ["newest mentions", [false, false, true], 0],
    ["2 of 3 miss, newest misses", [true, false, false], 1],
    ["only the last 3 count", [false, false, false, true, true, true], 0],
    ["two runs both miss", [false, false], 1],
    ["two runs, one miss", [true, false], 0],
  ];
  for (const [name, flags, expected] of cases) {
    const runs = flags.map((m, i) => run({ day: i + 1, mentioned: m }));
    assert.equal(derive(runs).length, expected, name);
  }
});

test("configurable threshold", () => {
  const runs = [run({ day: 1, mentioned: true }), run({ day: 2, mentioned: true }), run({ day: 3 })];
  assert.equal(derive(runs).length, 0);
  assert.equal(derive(runs, { minMisses: 1 }).length, 1);
});

test("failed calls store no row, so the last measured state stands", () => {
  assert.equal(derive([run({ day: 1, mentioned: true }), run({ day: 2, mentioned: true })]).length, 0);
});

test("inactive prompts are ignored", () => {
  assert.equal(deriveGeoGapFindings([run(), run()], [], project).length, 0);
});

test("simulated and real runs are never mixed", () => {
  const real = [run({ day: 1, mentioned: true }), run({ day: 2, mentioned: true })];
  const sim = [run({ day: 3, method: "simulated" }), run({ day: 4, method: "simulated" })];
  assert.equal(derive([...real, ...sim]).length, 0);
  const only = derive(sim);
  assert.equal(only[0].evidence.method, "simulated");
  assert.equal(only[0].evidence.runs.considered, 2);
  assert.match(only[0].recommendation, /simulated/i);
  const g = derive([run({ day: 1 }), run({ day: 2 }), run({ day: 3, method: "simulated", mentioned: true })]);
  assert.equal(g[0].evidence.method, "gemini-grounded");
  assert.deepEqual(g[0].evidence.runs, { considered: 2, notMentioned: 2, mentioned: 0 });
});

test("finding shape: identity, severity, plain title", () => {
  const [g] = derive([run()]);
  assert.equal(g.source, "geo");
  assert.equal(g.severity, "warning");
  assert.equal(g.entityId, "geo-gap:what is the best crm for a small team");
  assert.equal(g.title, `AI answers to "${PROMPT}" don't mention you`);
  assert.equal(geoGapEntityId("  WHAT is the best CRM for a small team?? "), g.entityId);
});

test("recommendation uses who is named instead and which sources are cited", () => {
  const runs = [
    run({ day: 1, competitors: ["HubSpot", "Zoho"], sources: ["https://www.g2.com/a", "https://acme.com/x"] }),
    run({ day: 2, competitors: ["HubSpot"], sources: ["https://g2.com/b", "https://capterra.com/c"] }),
  ];
  const [g] = derive(runs);
  assert.deepEqual(g.evidence.namedInstead, ["HubSpot", "Zoho"]);
  assert.deepEqual(g.evidence.sources, ["g2.com", "capterra.com"]);
  assert.match(g.recommendation, /HubSpot, Zoho instead of Acme/);
  assert.match(g.recommendation, /g2\.com, capterra\.com/);
  assert.match(g.recommendation, /FAQ/);
});

test("recommendation without competitor or source data stays honest", () => {
  const [g] = derive([run()]);
  assert.doesNotMatch(g.recommendation, /instead of/);
  assert.doesNotMatch(g.recommendation, /drew on/);
});

test("verify needs a later mentioned run of the same method and prompt", () => {
  const first = "2026-10-05T00:00:00.000Z";
  assert.equal(geoGapVerdict([run({ day: 2, mentioned: true })], PROMPT, "gemini-grounded", first), "no-new-runs");
  assert.equal(geoGapVerdict([run({ day: 9 })], PROMPT, "gemini-grounded", first), "not-mentioned");
  assert.equal(geoGapVerdict([run({ day: 9, mentioned: true })], PROMPT, "gemini-grounded", first), "mentioned");
  assert.equal(geoGapVerdict([run({ day: 9, mentioned: true, method: "simulated" })], PROMPT, "gemini-grounded", first), "no-new-runs");
  assert.equal(geoGapVerdict([run({ day: 9, mentioned: true, prompt: "Other?" })], PROMPT, "gemini-grounded", first), "no-new-runs");
});

test("verifyFinding: geo_gap is verified only with evidence, never by default", async () => {
  const f = { source: "geo", category: "geo_gap", entityId: "geo-gap:x", url: "https://acme.com/", severity: "warning" as const };
  const base = { runSeoAudit: async () => [], runGeoReadiness: async () => [] };
  const now = new Date();
  assert.equal((await verifyFinding(base, f, now)).outcome, "skipped");
  for (const [verdict, outcome] of [["mentioned", "verified"], ["not-mentioned", "failed"], ["no-new-runs", "skipped"]] as const) {
    assert.equal((await verifyFinding({ ...base, geoGapVerdict: async () => verdict }, f, now)).outcome, outcome);
  }
  const boom = await verifyFinding({ ...base, geoGapVerdict: async () => { throw new Error("boom"); } }, f, now);
  assert.equal(boom.outcome, "skipped");
});

// ---- fake store: upsert + verify ----

function fakeStore() {
  const rows = new Map<string, Finding>();
  let seq = 0;
  let clock = new Date("2026-10-05T12:00:00.000Z");
  const key = (i: { source: string; category: string; entityType: string; entityId: string; url: string | null }) =>
    [i.source, i.category, i.entityType, i.entityId, i.url ?? ""].join("|");
  const upsert = async (input: UpsertGapFinding): Promise<Finding> => {
    const existing = [...rows.values()].find((f) => key(f) === key(input));
    const status = existing?.status === "verified" ? "fixing" : (existing?.status ?? "new");
    const f: Finding = {
      id: existing?.id ?? `f${++seq}`, projectId: input.projectId, source: input.source, category: input.category, severity: input.severity,
      entityType: input.entityType, entityId: input.entityId, url: input.url, evidence: input.evidence, recommendation: input.recommendation,
      status, firstSeen: existing?.firstSeen ?? clock.toISOString(), lastSeen: clock.toISOString(), resolvedAt: null,
    };
    rows.set(f.id, f);
    return f;
  };
  const repository: FindingRepository = {
    get: (_p, id) => rows.get(id) ?? null,
    list: () => [...rows.values()],
    transition: (_p, id, status, from) => {
      const f = rows.get(id)!;
      if (from && f.status !== from) throw staleFindingError();
      const next = { ...f, status };
      rows.set(id, next);
      return next;
    },
    refresh: (_p, id, input) => {
      const f = rows.get(id)!;
      if (input.expectedStatus && f.status !== input.expectedStatus) throw staleFindingError();
      assert.ok(f.status === input.status || canTransitionFinding(f.status, input.status), "legal edge only");
      const next = { ...f, ...input, resolvedAt: input.status === "verified" ? clock.toISOString() : null };
      rows.set(id, next);
      return next;
    },
  };
  return { rows, upsert, repository, setClock: (d: Date) => { clock = d; } };
}

function ports(store: ReturnType<typeof fakeStore>, runs: GeoRunRow[]): GapSyncPorts {
  return {
    projectId: "p1",
    runs: async () => runs,
    activePrompts: async () => [PROMPT],
    listFindings: async () => [...store.rows.values()],
    upsert: store.upsert,
    repository: store.repository,
  };
}

test("sync: a gap becomes one finding, and rerunning does not duplicate it", async () => {
  const store = fakeStore();
  const runs = [run({ day: 1, competitors: ["HubSpot"] }), run({ day: 1 }), run({ day: 1 })];
  await syncGeoGapFindings(ports(store, runs), project, new Date("2026-10-05T13:00:00Z"));
  await syncGeoGapFindings(ports(store, runs), project, new Date("2026-10-05T14:00:00Z"));
  assert.equal(store.rows.size, 1);
  const f = [...store.rows.values()][0];
  assert.equal(f.status, "new");
  assert.equal(f.evidence.title, `AI answers to "${PROMPT}" don't mention you`);
});

test("sync: not yet re-run stays pending; a later mentioned run verifies it", async () => {
  const store = fakeStore();
  const old = [run({ day: 1 }), run({ day: 1 }), run({ day: 1 })];
  await syncGeoGapFindings(ports(store, old), project, new Date("2026-10-05T13:00:00Z"));
  const id = [...store.rows.keys()][0];

  const same = await syncGeoGapFindings(ports(store, old), project, new Date("2026-10-06T13:00:00Z"));
  assert.equal(same.verified, 0);
  assert.equal(store.rows.get(id)!.status, "new");

  const later = [...old, run({ day: 20, mentioned: true })];
  const res = await syncGeoGapFindings(ports(store, later), project, new Date("2026-10-21T13:00:00Z"));
  assert.equal(res.verified, 1);
  assert.equal(res.upserted, 0);
  assert.equal(store.rows.size, 1);
  assert.equal(store.rows.get(id)!.status, "verified");
  assert.ok(store.rows.get(id)!.resolvedAt);
});

test("sync: a verified gap does not reopen from old misses, only from fresh ones", async () => {
  const store = fakeStore();
  const old = [run({ day: 1 }), run({ day: 1 }), run({ day: 1 })];
  await syncGeoGapFindings(ports(store, old), project, new Date("2026-10-05T13:00:00Z"));
  const id = [...store.rows.keys()][0];
  const verifiedRuns = [...old, run({ day: 20, mentioned: true })];
  store.setClock(new Date("2026-10-21T13:00:00Z"));
  await syncGeoGapFindings(ports(store, verifiedRuns), project, new Date("2026-10-21T13:00:00Z"));
  await syncGeoGapFindings(ports(store, verifiedRuns), project, new Date("2026-10-22T13:00:00Z"));
  assert.equal(store.rows.get(id)!.status, "verified");

  const fresh = [...verifiedRuns, run({ day: 25 }), run({ day: 26 })];
  store.setClock(new Date("2026-10-27T13:00:00Z"));
  await syncGeoGapFindings(ports(store, fresh), project, new Date("2026-10-27T13:00:00Z"));
  assert.equal(store.rows.size, 1);
  assert.equal(store.rows.get(id)!.status, "fixing");
});

test("sync: a fixed finding whose later answers still miss goes to failed; an open one is left alone", async () => {
  const store = fakeStore();
  const old = [run({ day: 1 })];
  await syncGeoGapFindings(ports(store, old), project, new Date("2026-10-05T13:00:00Z"));
  const id = [...store.rows.keys()][0];
  const later = [...old, run({ day: 20 })];

  await syncGeoGapFindings(ports(store, later), project, new Date("2026-10-21T13:00:00Z"));
  assert.equal(store.rows.get(id)!.status, "new");

  store.rows.set(id, { ...store.rows.get(id)!, status: "fixed" });
  const res = await syncGeoGapFindings(ports(store, later), project, new Date("2026-10-21T14:00:00Z"));
  assert.equal(res.failed, 1);
  assert.equal(store.rows.get(id)!.status, "failed");
});

test("catalogue: the Findings tab recommendation names who and where", () => {
  const [g] = derive([run({ competitors: ["HubSpot"], sources: ["https://g2.com/a"] })]);
  const entry = catalogEntry({ entityId: g.entityId, evidence: { ...g.evidence, title: g.title }, source: "geo", category: "geo_gap" });
  assert.match(entry!.summary, /HubSpot/);
  assert.match(entry!.action, /g2\.com/);
});
