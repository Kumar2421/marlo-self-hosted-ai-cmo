import test from "node:test";
import assert from "node:assert/strict";
import { runAutoCompanyLeads, usesCompanySearch } from "../lib/domain/leads/company/autoCompanyLeads.ts";

const profile = { industries: ["dental clinics"], locations: ["Chennai"], exclude: [] as string[] };
const enriched = (over: Record<string, unknown> = {}) => ({ status: "ok" as const, emails: [], whatsapp: null, contactUrl: null, description: null, ...over });

function ports(hits: { title: string; url: string; content: string }[], enrich: () => unknown, opts: { known?: string[]; saveError?: string } = {}) {
  const saved: Record<string, unknown>[][] = [];
  return {
    saved,
    ports: {
      provider: { id: "fake", search: async () => hits },
      knownHosts: async () => new Set(opts.known ?? []),
      enrich: (async () => enrich()) as never,
      save: async (rows: Record<string, unknown>[]) => {
        if (opts.saveError) return { ok: false as const, error: opts.saveError };
        saved.push(rows);
        return { ok: true as const };
      },
    },
  };
}

const HIT = { title: "Smile Dental | Chennai", url: "https://smile.test/", content: "Dental clinics in Chennai" };

test("the company search is the free search only for a profile with company types and no job title", () => {
  assert.equal(usesCompanySearch({ roles: [], industries: ["dental clinics"] }), true);
  assert.equal(usesCompanySearch({ roles: ["Founder"], industries: ["dental clinics"] }), false);
  assert.equal(usesCompanySearch({ roles: [], industries: [] }), false);
});

test("saves reachable companies as auto-generated company leads with their reason and source", async () => {
  const { ports: p, saved } = ports([HIT], () => enriched({ emails: ["hello@smile.test"], contactUrl: "https://smile.test/contact" }));
  const res = await runAutoCompanyLeads(p, { profile, limit: 5, now: new Date("2026-11-11T00:10:00Z") });
  assert.equal(res.added, 1);
  assert.equal(res.reason, null);
  const row = saved[0][0];
  assert.equal(row.lead_type, "company");
  assert.equal(row.auto_generated, true);
  assert.equal(row.email, "hello@smile.test");
  assert.equal(row.source_url, "https://smile.test/contact");
  assert.match(String(row.fit_reason), /dental clinics/);
  assert.equal(row.created_at, "2026-11-11T00:10:00.000Z");
});

test("the daily limit caps how many are saved", async () => {
  const hits = ["a", "b", "c", "d"].map((n) => ({ title: `Dental ${n}`, url: `https://${n}.test/`, content: "dental clinics Chennai" }));
  const { ports: p, saved } = ports(hits, () => enriched({ emails: ["info@x.test"] }));
  const res = await runAutoCompanyLeads(p, { profile, limit: 2 });
  assert.equal(res.added, 2);
  assert.equal(saved[0].length, 2);
});

test("companies with no contact are explained, not saved; duplicates and empty searches say so", async () => {
  const none = await runAutoCompanyLeads(ports([HIT], () => enriched()).ports, { profile, limit: 5 });
  assert.equal(none.reason, "none_found");
  assert.match(String(none.message), /none showed an email or WhatsApp/);

  const dup = await runAutoCompanyLeads(ports([HIT], () => enriched({ emails: ["a@smile.test"] }), { known: ["smile.test"] }).ports, { profile, limit: 5 });
  assert.equal(dup.reason, "all_duplicates");

  const empty = await runAutoCompanyLeads(ports([], () => enriched()).ports, { profile, limit: 5 });
  assert.equal(empty.reason, "none_found");
  assert.match(String(empty.message), /no matching companies/);
});

test("a save failure is reported and nothing is counted as added", async () => {
  const res = await runAutoCompanyLeads(ports([HIT], () => enriched({ emails: ["a@smile.test"] }), { saveError: "db down" }).ports, { profile, limit: 5 });
  assert.equal(res.added, 0);
  assert.equal(res.reason, "save_failed");
  assert.match(String(res.message), /db down/);
});

test("the run target describes the company search so logs and the cron summary stay readable", async () => {
  const res = await runAutoCompanyLeads(ports([], () => enriched()).ports, { profile, limit: 5 });
  assert.deepEqual(res.target, { role: "", industry: "dental clinics", location: "Chennai", source: "lead-profile-companies" });
});
