import { test } from "node:test";
import * as assert from "node:assert";
import { createSupabaseGateway } from "../lib/domain/assistant/gateway/supabaseGateway.ts";
import { createSqliteGateway } from "../lib/domain/assistant/gateway/sqliteGateway.ts";
import { gatewayChatPorts } from "../lib/domain/assistant/gateway/gatewayPorts.ts";
import { GATEWAY_METHODS, type DataGateway } from "../lib/domain/assistant/gateway/types.ts";
import { ScopeError } from "../lib/domain/assistant/gateway/scope.ts";
import { runTool } from "../lib/domain/chat/tools.ts";

const UA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PA = "a0000000-0000-4000-8000-00000000000a";
const PB = "b0000000-0000-4000-8000-00000000000b";
const FA = "fa000000-0000-4000-8000-0000000000fa";
const FB = "fb000000-0000-4000-8000-0000000000fb";

type Row = Record<string, unknown>;

/** A fake Supabase that IGNORES every filter and returns the whole table: the worst case for tenancy. */
function fakeDb(tables: Record<string, Row[]>, touched: string[] = []) {
  return {
    from(table: string) {
      touched.push(table);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "order", "limit", "lte"]) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown) => res({ data: tables[table] ?? [], error: null });
      return b;
    },
  } as never;
}

const finding = (id: string, userId: string, projectId: string): Row => ({
  id, user_id: userId, project_id: projectId, source: "seo", category: "missing_canonical", severity: "warning",
  entity_type: "page", entity_id: "e", url: "https://x.com/a", evidence: {}, recommendation: "Add a canonical tag",
  status: "new", first_seen: "2026-09-01", last_seen: "2026-09-20", resolved_at: null,
});
const lead = (userId: string, projectId: string, name: string, email: string | null): Row => ({
  user_id: userId, project_id: projectId, name, title: "CEO", company: "Acme", location: "NYC", lead_type: "person",
  email, email_verified: !!email, emailed_at: null, last_reply_at: null, created_at: "2026-10-01T00:00:00Z",
});

const tables = (): Record<string, Row[]> => ({
  projects: [{ id: PA, owner_id: UA }, { id: PB, owner_id: UB }],
  findings: [finding(FB, UB, PB), finding(FA, UA, PA)],
  actions: [
    { id: "action_b", project_id: PB, finding_id: FB, type: "manual_fix", status: "proposed", title: "B action", target: {}, created_at: "2026-10-01" },
    { id: "action_a", project_id: PA, finding_id: FA, type: "manual_fix", status: "proposed", title: "A action", target: {}, created_at: "2026-10-01" },
  ],
  leads: [lead(UB, PB, "Bob Secret", "bob@b.com"), lead(UA, PA, "Alice", "alice@a.com"), lead(UA, PA, "Al2", null)],
  search_snapshots: [
    { user_id: UB, project_id: PB, snapshot_date: "2026-10-02", payload: { b: true } },
    { user_id: UA, project_id: PA, snapshot_date: "2026-10-01", payload: { a: true } },
  ],
  geo_checks: [
    { user_id: UB, project_id: PB, payload: [{ query: "b-query", found: true }], checked_at: "2026-10-01" },
    { user_id: UA, project_id: PA, payload: [{ query: "a-query", found: false }], checked_at: "2026-10-01" },
  ],
  seo_audits: [
    { user_id: UB, project_id: PB, url: "https://b.com", payload: { url: "https://b.com", issues: [] }, created_at: "2026-10-01" },
    { user_id: UA, project_id: PA, url: "https://a.com", payload: { url: "https://a.com", issues: [] }, created_at: "2026-10-01" },
  ],
  project_competitors: [
    { user_id: UB, project_id: PB, url: "https://comp-b.com", created_at: "2026-10-01" },
    { user_id: UA, project_id: PA, url: "https://comp-a.com", created_at: "2026-10-01" },
  ],
});

const scopeA = { userId: UA, projectId: PA };

test("hosted gateway: user A never receives user B rows even when the backend ignores every filter", async () => {
  const gw = createSupabaseGateway(fakeDb(tables()));
  const findings = await gw.listFindings(scopeA);
  assert.deepEqual(findings.map((f) => f.id), [FA]);
  assert.equal((await gw.getSearchSnapshot(scopeA))?.snapshotDate, "2026-10-01");
  assert.deepEqual((await gw.listActions(scopeA)).map((a) => a.id), ["action_a"]);
  const leads = await gw.getLeadSummary(scopeA, 10);
  assert.equal(leads.total, 2);
  assert.ok(!JSON.stringify(leads).includes("Bob"));
  assert.deepEqual((await gw.getGeoStatus(scopeA))?.rows.map((r) => r.query), ["a-query"]);
  assert.equal((await gw.getAuditSummary(scopeA))?.url, "https://a.com");
  assert.deepEqual(await gw.listCompetitors(scopeA), ["https://comp-a.com"]);
});

test("hosted gateway: a finding id from another project is rejected (looks like missing)", async () => {
  const gw = createSupabaseGateway(fakeDb(tables()));
  assert.equal(await gw.getFinding(scopeA, FB), null);
  assert.equal((await gw.getFinding(scopeA, FA))?.id, FA);
  assert.equal(await gw.getFinding(scopeA, "not-a-uuid"), null);
  assert.deepEqual(await gw.listActions(scopeA, FB), []);
});

test("hosted gateway: a project the user does not own is refused for every dataset", async () => {
  const gw = createSupabaseGateway(fakeDb(tables()));
  const wrong = { userId: UA, projectId: PB };
  for (const call of [
    () => gw.getSearchSnapshot(wrong), () => gw.listFindings(wrong), () => gw.getFinding(wrong, FB),
    () => gw.listActions(wrong), () => gw.getLeadSummary(wrong, 5), () => gw.getGeoStatus(wrong),
    () => gw.getAuditSummary(wrong), () => gw.listCompetitors(wrong),
  ]) {
    await assert.rejects(call, ScopeError);
  }
});

test("every gateway function requires a valid scope and touches no table without one", async () => {
  const touched: string[] = [];
  const hosted = createSupabaseGateway(fakeDb(tables(), touched));
  const prepared: string[] = [];
  const local = createSqliteGateway({ prepare: (sql) => { prepared.push(sql); return { all: () => [] }; } });
  for (const gw of [hosted, local] as DataGateway[]) {
    for (const name of GATEWAY_METHODS) {
      const fn = gw[name] as (...a: unknown[]) => Promise<unknown>;
      assert.ok(fn.length >= 1, `${name} declares a scope parameter`);
      for (const bad of [undefined, null, {}, { userId: UA }, { userId: "x", projectId: "" }]) {
        await assert.rejects(() => fn(bad, "f"), ScopeError, `${name} rejects ${JSON.stringify(bad)}`);
      }
    }
  }
  assert.deepEqual(touched, []);
  assert.deepEqual(prepared, []);
});

test("self-host gateway: parameterised, project-scoped, and rows from other projects are dropped", async () => {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  const evil = "x' OR '1'='1";
  const db = {
    prepare(sql: string) {
      return {
        // Ignores the WHERE clause on purpose: returns rows from two projects.
        all: (...params: unknown[]) => {
          seen.push({ sql, params });
          if (/FROM findings/.test(sql)) return [finding(FA, "", "p-local") , finding(FB, "", "p-other")].map((r) => ({ ...r, evidence: "{}" }));
          if (/FROM leads/.test(sql)) return [{ project_id: "p-local", name: "L", email: "e@x.com", created_at: "2026-10-01" }, { project_id: "p-other", name: "Other", email: "o@x.com", created_at: "2026-10-02" }];
          return [];
        },
      };
    },
  };
  const gw = createSqliteGateway(db);
  const found = await gw.listFindings({ userId: null, projectId: "p-local" });
  assert.deepEqual(found.map((f) => f.projectId), ["p-local"]);
  const leads = await gw.getLeadSummary({ userId: null, projectId: "p-local" }, 5);
  assert.equal(leads.total, 1);
  assert.ok(!JSON.stringify(leads).includes("@"));
  await gw.getFinding({ userId: null, projectId: evil }, FA);
  await gw.listCompetitors({ userId: null, projectId: evil });
  for (const q of seen) {
    assert.match(q.sql, /project_id = \?/);
    assert.ok(!q.sql.includes("x'"), "ids are never interpolated into SQL");
    assert.equal(q.params[0] === "p-local" || q.params[0] === evil, true);
  }
});

test("tools over the gateway: injected scope text and a foreign finding id leak nothing", async () => {
  const records: unknown[] = [];
  const ports = gatewayChatPorts(createSupabaseGateway(fakeDb(tables())), scopeA, {
    recommendationsFor: () => [], audit: (r) => records.push(r),
  });
  const foreign = await runTool(ports, "get_finding", { id: FB });
  assert.equal(foreign.ok, false);
  assert.ok(!foreign.content.includes("B action") && !foreign.content.includes(PB));
  const mine = await runTool(ports, "get_finding", { id: FA });
  assert.equal(mine.ok, true);
  const leads = await runTool(ports, "list_leads", {});
  assert.ok(!leads.content.includes("@") && !leads.content.includes("Bob"));
});
