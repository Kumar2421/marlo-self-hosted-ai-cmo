import test from "node:test";
import assert from "node:assert/strict";
import type { LocalPlace, PlacesPageResult } from "../lib/domain/leads/local/placesSearch.ts";
import { scoreLocalLead } from "../lib/domain/leads/local/fitReason.ts";
import { isOwnSiteEmail, searchLocalLeads, type LocalSearchPorts } from "../lib/domain/leads/local/localLeadService.ts";
import type { Enrichment } from "../lib/domain/leads/local/websiteContact.ts";

function place(id: string, extra: Partial<LocalPlace> = {}): LocalPlace {
  return {
    id,
    name: `Biz ${id}`,
    address: "1 Main St",
    phone: null,
    website: `https://${id}.example.com`,
    rating: 4.5,
    reviewCount: 40,
    businessStatus: "OPERATIONAL",
    primaryType: "Plumber",
    mapsUrl: null,
    ...extra,
  };
}

const EMPTY: Enrichment = { status: "ok", emails: [], whatsapp: null, contactUrl: null, description: null };

function ports(over: Partial<LocalSearchPorts> & { places?: LocalPlace[]; nextPageToken?: string | null; existing?: string[] } = {}): LocalSearchPorts {
  const page: PlacesPageResult = { places: over.places ?? [], nextPageToken: over.nextPageToken ?? null };
  return {
    searchPage: over.searchPage ?? (async () => page),
    existingPlaceIds: over.existingPlaceIds ?? (async () => new Set(over.existing ?? [])),
    enrich: over.enrich ?? (async () => EMPTY),
    emailCheck: over.emailCheck ?? (async () => true),
  };
}

const base = { projectId: "proj-1", category: "Plumber", location: "Austin" };

test("dedupe: places the project already has are dropped and counted", async () => {
  const result = await searchLocalLeads(
    ports({ places: [place("a"), place("b"), place("c")], existing: ["b"] }),
    base
  );
  assert.deepEqual(result.leads.map((l) => l.placeId).sort(), ["a", "c"]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.skipped, 0);
});

test("dedupe: the same place id twice on one page is kept once", async () => {
  const result = await searchLocalLeads(ports({ places: [place("a"), place("a")] }), base);
  assert.equal(result.leads.length, 1);
});

test("no website: no enrichment call, status no_website, still scored", async () => {
  let enrichCalls = 0;
  const result = await searchLocalLeads(
    ports({
      places: [place("nosite", { website: null })],
      enrich: async () => {
        enrichCalls += 1;
        return EMPTY;
      },
    }),
    base
  );
  assert.equal(enrichCalls, 0);
  assert.equal(result.leads[0].enrichmentStatus, "no_website");
  assert.equal(result.leads[0].email, null);
  assert.match(result.leads[0].fitReason, /no website listed/);
});

test("blocked enrichment is kept as blocked with no contact fields", async () => {
  const result = await searchLocalLeads(
    ports({
      places: [place("priv")],
      enrich: async () => ({ ...EMPTY, status: "blocked" }),
    }),
    base
  );
  assert.equal(result.leads[0].enrichmentStatus, "blocked");
  assert.equal(result.leads[0].whatsapp, null);
  assert.equal(result.skipped, 0);
});

test("email: the best scraped email is MX-checked and marked domain_found or unknown", async () => {
  const enrich = async (website: string): Promise<Enrichment> =>
    website.includes("good")
      ? { ...EMPTY, emails: ["owner@mailhost.example.net", "other@mailhost.example.net"] }
      : { ...EMPTY, emails: ["hi@elsewhere.example.org"] };
  const checked: string[] = [];
  const result = await searchLocalLeads(
    ports({
      places: [place("good"), place("bad")],
      enrich,
      emailCheck: async (email) => {
        checked.push(email);
        return email.endsWith("mailhost.example.net");
      },
    }),
    base
  );
  const byId = Object.fromEntries(result.leads.map((l) => [l.placeId, l]));
  assert.equal(byId.good.email, "owner@mailhost.example.net");
  assert.equal(byId.good.emailQuality, "domain_found");
  assert.equal(byId.bad.email, "hi@elsewhere.example.org");
  assert.equal(byId.bad.emailQuality, "unknown");
  assert.deepEqual(checked.sort(), ["hi@elsewhere.example.org", "owner@mailhost.example.net"]);
});

test("email on the business's own domain is source_found and skips the mail check", async () => {
  const checked: string[] = [];
  const result = await searchLocalLeads(
    ports({
      places: [place("own")],
      enrich: async () => ({ ...EMPTY, emails: ["hello@own.example.com", "x@gmail.com"] }),
      emailCheck: async (email) => {
        checked.push(email);
        return true;
      },
    }),
    base
  );
  assert.equal(result.leads[0].email, "hello@own.example.com");
  assert.equal(result.leads[0].emailQuality, "source_found");
  assert.deepEqual(checked, []);
});

test("isOwnSiteEmail matches the site domain and its subdomains only", () => {
  assert.equal(isOwnSiteEmail("a@acme.com", "https://www.acme.com/contact"), true);
  assert.equal(isOwnSiteEmail("a@mail.acme.com", "acme.com"), true);
  assert.equal(isOwnSiteEmail("a@notacme.com", "acme.com"), false);
  assert.equal(isOwnSiteEmail("a@gmail.com", "acme.com"), false);
  assert.equal(isOwnSiteEmail("a@acme.com", ""), false);
});

test("email check that throws is treated as unknown, not a crash", async () => {
  const result = await searchLocalLeads(
    ports({
      places: [place("x")],
      enrich: async () => ({ ...EMPTY, emails: ["a@elsewhere.example.org"] }),
      emailCheck: async () => {
        throw new Error("dns down");
      },
    }),
    base
  );
  assert.equal(result.leads[0].emailQuality, "unknown");
});

test("budget: enrichment that runs past the budget is skipped, others still finish", async () => {
  const places = [place("fast"), place("slow1"), place("slow2")];
  const result = await searchLocalLeads(
    ports({
      places,
      enrich: async (website: string) => {
        if (website.includes("slow")) await new Promise((r) => setTimeout(r, 400));
        return { ...EMPTY, description: `desc for ${website}` };
      },
    }),
    { ...base, budgetMs: 80, concurrency: 4 }
  );
  const byId = Object.fromEntries(result.leads.map((l) => [l.placeId, l]));
  assert.equal(byId.fast.enrichmentStatus, "ok");
  assert.equal(byId.slow1.enrichmentStatus, "skipped");
  assert.equal(byId.slow2.enrichmentStatus, "skipped");
  assert.equal(result.skipped, 2);
  assert.equal(result.leads.length, 3);
});

test("budget: a zero budget skips every enrichment without calling it", async () => {
  let calls = 0;
  const result = await searchLocalLeads(
    ports({
      places: [place("a"), place("b")],
      enrich: async () => {
        calls += 1;
        return EMPTY;
      },
    }),
    { ...base, budgetMs: 0 }
  );
  assert.equal(calls, 0);
  assert.equal(result.skipped, 2);
  assert.ok(result.leads.every((l) => l.enrichmentStatus === "skipped"));
});

test("concurrency is capped", async () => {
  let active = 0;
  let peak = 0;
  const places = Array.from({ length: 10 }, (_, i) => place(`p${i}`));
  await searchLocalLeads(
    ports({
      places,
      enrich: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return EMPTY;
      },
    }),
    { ...base, concurrency: 4 }
  );
  assert.ok(peak <= 4, `peak ${peak}`);
  assert.ok(peak >= 2);
});

test("paging: the next token comes back and is passed through to the page search", async () => {
  const seen: (string | undefined)[] = [];
  const result = await searchLocalLeads(
    ports({
      searchPage: async (input) => {
        seen.push(input.pageToken);
        return { places: [place("a")], nextPageToken: input.pageToken ? null : "NEXT" };
      },
    }),
    base
  );
  assert.equal(result.nextPageToken, "NEXT");
  const second = await searchLocalLeads(
    ports({
      searchPage: async (input) => {
        seen.push(input.pageToken);
        return { places: [], nextPageToken: null };
      },
    }),
    { ...base, pageToken: "NEXT" }
  );
  assert.equal(second.nextPageToken, null);
  assert.deepEqual(seen, [undefined, "NEXT"]);
});

test("results are sorted by fit, best first", async () => {
  const result = await searchLocalLeads(
    ports({
      places: [place("weak", { website: null, rating: 3, reviewCount: 2 }), place("strong", { rating: 4.9, reviewCount: 500 })],
      enrich: async () => ({ ...EMPTY, emails: ["a@strong.example.com"] }),
    }),
    base
  );
  assert.equal(result.leads[0].placeId, "strong");
  assert.ok(result.leads[0].score > result.leads[1].score);
});

test("scoreLocalLead: table of reasons built only from real fields", () => {
  const wanted = { category: "plumber", location: "Austin" };
  const cases: { name: string; place: LocalPlace; enr: Partial<Enrichment>; reason: string }[] = [
    {
      name: "full",
      place: place("a", { rating: 4.7, reviewCount: 212 }),
      enr: { emails: ["x@a.com"] },
      reason: "Plumber in Austin, 4.7 stars from 212 reviews, has a website and a public email",
    },
    {
      name: "single review",
      place: place("a", { rating: 5, reviewCount: 1 }),
      enr: {},
      reason: "Plumber in Austin, 5.0 stars from 1 review, has a website",
    },
    {
      name: "zero reviews drops the rating clause",
      place: place("a", { rating: null, reviewCount: null, website: null }),
      enr: {},
      reason: "Plumber in Austin, no website listed",
    },
    {
      name: "whatsapp listed",
      place: place("a", { rating: null, reviewCount: null }),
      enr: { whatsapp: "15125550100" },
      reason: "Plumber in Austin, has a website, WhatsApp listed",
    },
    {
      name: "email only",
      place: place("a", { website: null, rating: 4, reviewCount: 0 }),
      enr: { emails: ["x@b.com"] },
      reason: "Plumber in Austin, 4.0 stars, has a public email",
    },
  ];
  for (const c of cases) {
    assert.equal(scoreLocalLead(c.place, { emails: [], whatsapp: null, contactUrl: null, description: null, ...c.enr }, wanted).reason, c.reason, c.name);
  }
});

test("scoreLocalLead: more signals score higher and location is optional", () => {
  const none = scoreLocalLead(place("a", { website: null, rating: null, reviewCount: null, primaryType: null }), { emails: [], whatsapp: null, contactUrl: null, description: null }, { category: "plumber" });
  const all = scoreLocalLead(place("a", { rating: 4.9, reviewCount: 900 }), { emails: ["x@a.com"], whatsapp: "15125550100", contactUrl: "https://a.com/contact", description: "Hi" }, { category: "plumber" });
  assert.ok(all.score > none.score);
  assert.equal(none.reason, "Plumber, no website listed");
});
