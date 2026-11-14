import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuditProfilePrompt,
  deriveAuditProfile,
  findAuditLeads,
  parseAuditProfile,
  toPublicLead,
  type AuditPage,
} from "../lib/domain/audit/auditLeads.ts";
import type { CompanyLeadDraft, CompanySearchPorts } from "../lib/domain/leads/company/companyLeads.ts";
import type { LlmDriver } from "../lib/llm/types.ts";

const PAGE: AuditPage = { title: "Booking software for dental clinics", description: "Fill your chairs", h1: "Dental booking", bodyText: "We help clinics in Chennai get more patients." };

const draft = (over: Partial<CompanyLeadDraft> = {}): CompanyLeadDraft => ({
  name: "Acharya Dental", website: "https://acharya.test", host: "acharya.test", email: "info@acharya.test", emailQuality: "source_found",
  whatsapp: null, contactUrl: "https://acharya.test/contact", description: null, sourceUrl: "https://acharya.test/contact",
  fitReason: 'Company site mentions "dental"; mentions chennai. Signals: opening a new branch.', signals: [], ...over,
});

const driverReturning = (...replies: string[]): { driver: LlmDriver; calls: number[] } => {
  const calls: number[] = [];
  let i = 0;
  const driver = (async () => {
    calls.push(i);
    return { text: replies[Math.min(i++, replies.length - 1)] };
  }) as unknown as LlmDriver;
  return { driver, calls };
};

test("the profile prompt carries the page as data and is length-capped", () => {
  const prompt = buildAuditProfilePrompt({ ...PAGE, bodyText: "x".repeat(10_000) });
  assert.ok(prompt.includes("Booking software for dental clinics"));
  assert.ok(prompt.length < 3200);
});

test("a model reply becomes at most 3 industries and 2 places", () => {
  const p = parseAuditProfile('{"industries":["dental clinics","orthodontists","dentists","vets"],"locations":["Chennai","India","Mumbai"]}');
  assert.deepEqual(p, { industries: ["dental clinics", "orthodontists", "dentists"], locations: ["Chennai", "India"] });
});

test("terms that are links, addresses, code or too long are dropped", () => {
  const p = parseAuditProfile(JSON.stringify({
    industries: ["https://evil.test", "dental clinics", "mail me@x.com", "a".repeat(200), "<b>x</b>", "Dental Clinics", 5, null, "two\nlines"],
    locations: ["www.spam.test", "Chennai"],
  }));
  assert.deepEqual(p, { industries: ["dental clinics", "two lines"], locations: ["Chennai"] });
});

test("junk that is not a JSON object gives null", () => {
  for (const raw of ["", "no json here", "[1,2]", "{broken"]) assert.equal(parseAuditProfile(raw), null, raw);
});

test("deriveAuditProfile repairs once, then gives up without throwing", async () => {
  const once = driverReturning("sorry", '{"industries":["dental clinics"],"locations":[]}');
  assert.deepEqual(await deriveAuditProfile({ driver: once.driver, apiKey: "k", model: "m", page: PAGE }), { industries: ["dental clinics"], locations: [] });
  assert.equal(once.calls.length, 2);
  const never = driverReturning("nope");
  assert.equal(await deriveAuditProfile({ driver: never.driver, apiKey: "k", model: "m", page: PAGE }), null);
  assert.equal(never.calls.length, 2);
});

test("the public teaser never carries an address, a number or a contact page", () => {
  const lead = toPublicLead(draft({ whatsapp: "+914412345678" }));
  assert.deepEqual(lead.channels, ["email", "whatsapp"]);
  const text = JSON.stringify(lead);
  for (const secret of ["info@acharya.test", "+914412345678", "/contact", "https://"]) assert.ok(!text.includes(secret), secret);
  assert.ok(!lead.fitReason.includes("Signals"), "the signals sentence stays out of the teaser");
  assert.equal(lead.fitReason, 'Company site mentions "dental"; mentions chennai.');
});

test("a contact form is shown only when there is no email or number", () => {
  assert.deepEqual(toPublicLead(draft({ email: null, whatsapp: null })).channels, ["form"]);
  assert.deepEqual(toPublicLead(draft({ email: null, whatsapp: "+91" })).channels, ["whatsapp"]);
});

function setup(profile: { industries: string[]; locations: string[] } | null) {
  const searched: string[] = [];
  const search: CompanySearchPorts = {
    provider: { search: async (q: string) => { searched.push(q); return []; } } as unknown as CompanySearchPorts["provider"],
    knownHosts: async () => new Set(),
    enrich: async () => { throw new Error("not reached"); },
  };
  return { searched, ports: { derive: async () => profile, search } };
}

test("a site that sells to consumers gets an honest 'none', and no web search is made", async () => {
  const t = setup({ industries: [], locations: [] });
  assert.deepEqual(await findAuditLeads(t.ports, { page: PAGE, ownHost: "x.test" }), { status: "none", reason: "no_business_buyers" });
  assert.equal(t.searched.length, 0);
});

test("a failed model step is 'unavailable', not an empty result", async () => {
  const t = setup(null);
  assert.deepEqual(await findAuditLeads(t.ports, { page: PAGE, ownHost: "x.test" }), { status: "unavailable", reason: "model_failed" });
});

test("nothing reachable found is 'none' with its own reason", async () => {
  const t = setup({ industries: ["dental clinics"], locations: ["Chennai"] });
  assert.deepEqual(await findAuditLeads(t.ports, { page: PAGE, ownHost: "x.test" }), { status: "none", reason: "no_reachable_match" });
  assert.ok(t.searched.length > 0, "the search ran with the derived profile");
  assert.ok(t.searched[0].includes("dental clinics"));
});
