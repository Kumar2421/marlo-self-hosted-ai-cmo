import test from "node:test";
import assert from "node:assert/strict";
import { buildCompanyQueries, describeCompanyFit, searchCompanyLeads } from "../lib/domain/leads/company/companyLeads.ts";

const enriched = (over: Record<string, unknown> = {}) => ({ status: "ok" as const, emails: [], whatsapp: null, contactUrl: null, description: null, ...over });
const profile = { industries: ["dental clinics"], locations: ["Chennai"] };

function ports(hits: { title: string; url: string; content: string }[], enrich: (site: string) => unknown, known: string[] = []) {
  return {
    provider: { id: "fake", search: async () => hits },
    knownHosts: async () => new Set(known),
    enrich: (async (site: string) => enrich(site)) as never,
  };
}

test("queries combine company types and places, capped at three", () => {
  assert.deepEqual(buildCompanyQueries({ industries: ["dental clinics"], locations: ["Chennai", "Madurai"] }), ["dental clinics Chennai contact us", "dental clinics Madurai contact us"]);
  assert.equal(buildCompanyQueries({ industries: ["a", "b", "c", "d"], locations: [] }).length, 3);
  assert.deepEqual(buildCompanyQueries({ industries: [], locations: ["x"] }), []);
});

test("fit reason uses only words found on the company's pages; none means no reason", () => {
  assert.match(describeCompanyFit(profile, "Smile Dental Clinics in Chennai"), /mentions "dental clinics"; mentions chennai/);
  assert.equal(describeCompanyFit(profile, "We repair bicycles"), "");
});

test("keeps a company with an email found on its site, a reason, and a source page", async () => {
  const res = await searchCompanyLeads(
    ports([{ title: "Smile Dental | Chennai", url: "https://smile.test/", content: "Dental clinics in Chennai" }], () => enriched({ emails: ["hi@smile.test"], contactUrl: "https://smile.test/contact" })),
    { profile },
  );
  assert.equal(res.leads.length, 1);
  assert.equal(res.leads[0].name, "Smile Dental");
  assert.equal(res.leads[0].emailQuality, "source_found");
  assert.equal(res.leads[0].sourceUrl, "https://smile.test/contact");
});

test("a company with no email or WhatsApp is dropped and counted, never saved as a lead", async () => {
  const res = await searchCompanyLeads(ports([{ title: "Smile Dental", url: "https://smile.test/", content: "dental clinics Chennai" }], () => enriched({ contactUrl: "https://smile.test/contact" })), { profile });
  assert.equal(res.leads.length, 0);
  assert.equal(res.droppedNoContact, 1);
});

test("a company that does not match the profile is dropped even with a contact", async () => {
  const res = await searchCompanyLeads(ports([{ title: "Bike Repair", url: "https://bike.test/", content: "bicycle repair" }], () => enriched({ emails: ["a@bike.test"] })), { profile });
  assert.equal(res.leads.length, 0);
  assert.equal(res.droppedNoFit, 1);
});

test("a WhatsApp number alone is enough to reach a company", async () => {
  const res = await searchCompanyLeads(ports([{ title: "Smile Dental", url: "https://smile.test/", content: "dental clinics Chennai" }], () => enriched({ whatsapp: "+91 98765 43210" })), { profile });
  assert.equal(res.leads.length, 1);
  assert.equal(res.leads[0].email, null);
});

test("known hosts, the user's own site and excluded companies are never returned", async () => {
  const hits = ["known", "mine", "rival", "fresh"].map((n) => ({ title: n, url: `https://${n}.test/`, content: "dental clinics Chennai" }));
  const res = await searchCompanyLeads(ports(hits, () => enriched({ emails: ["a@x.test"] }), ["known.test"]), { profile: { ...profile, exclude: ["rival.test"] }, ownHost: "mine.test" });
  assert.deepEqual(res.leads.map((l) => l.host), ["fresh.test"]);
  assert.equal(res.duplicates, 1);
});

test("a failing search or enrichment never throws", async () => {
  const bad = {
    provider: { id: "x", search: async () => { throw new Error("down"); } },
    knownHosts: async () => new Set<string>(),
    enrich: (async () => { throw new Error("x"); }) as never,
  };
  assert.deepEqual((await searchCompanyLeads(bad, { profile })).leads, []);
  const res = await searchCompanyLeads(ports([{ title: "A", url: "https://a.test/", content: "dental clinics" }], () => { throw new Error("boom"); }), { profile });
  assert.equal(res.leads.length, 0);
});

test("enrichment past the time budget is skipped", async () => {
  const slow = ports([{ title: "A", url: "https://a.test/", content: "dental clinics" }], () => new Promise(() => {}));
  const res = await searchCompanyLeads(slow, { profile, budgetMs: 30 });
  assert.equal(res.leads.length, 0);
});

test("a signal the site states is saved in the reason and ranks that company first under the cap", async () => {
  const hits = ["a", "b", "c"].map((n) => ({ title: `Dental ${n}`, url: `https://${n}.test/`, content: "dental clinics Chennai" }));
  const perSite: Record<string, unknown> = {
    "https://a.test/": enriched({ emails: ["info@a.test"] }),
    "https://b.test/": enriched({ emails: ["info@b.test"], signals: ["hiring", "new_location"] }),
    "https://c.test/": enriched({ emails: ["info@c.test"], signals: ["hiring"] }),
  };
  const res = await searchCompanyLeads(
    { provider: { id: "f", search: async () => hits }, knownHosts: async () => new Set<string>(), enrich: (async (site: string) => perSite[site]) as never },
    { profile, maxLeads: 2 },
  );
  assert.deepEqual(res.leads.map((l) => l.host), ["b.test", "c.test"]);
  assert.match(res.leads[0].fitReason, /Signals: hiring now; new location\./);
  assert.deepEqual(res.leads[0].signals, ["hiring", "new_location"]);
  assert.doesNotMatch(res.leads[1].fitReason, /new location/);
});

test("a company with no signal has no Signals sentence", async () => {
  const res = await searchCompanyLeads(ports([{ title: "Smile Dental", url: "https://smile.test/", content: "dental clinics Chennai" }], () => enriched({ emails: ["a@smile.test"] })), { profile });
  assert.doesNotMatch(res.leads[0].fitReason, /Signals/);
  assert.deepEqual(res.leads[0].signals, []);
});
