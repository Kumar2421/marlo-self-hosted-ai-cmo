import test from "node:test";
import assert from "node:assert/strict";
import {
  archetypeLabel, emptyOfferModel, enforceEvidence, isEmptyOffer, locateQuote, normalizeForMatch, normalizeOfferModel, quoteInSources,
  type SourceText,
} from "../lib/domain/offer/offerModel.ts";

const HOME: SourceText = {
  url: "https://acme.example/",
  text: "Acme builds custom software, CRM and automation for small businesses in Tamil Nadu.  Our clinics and retail customers   lose deals to spreadsheets.",
};
const PRICING: SourceText = { url: "https://acme.example/pricing", text: "Plans for founders and operations managers who need a CRM without a big team." };

test("normalizeOfferModel is total: garbage in, a valid empty model out", () => {
  for (const bad of [null, undefined, "nope", 5, [], {}]) {
    const m = normalizeOfferModel(bad, new Date("2026-11-05T00:00:00Z"));
    assert.equal(m.version, 1);
    assert.equal(m.archetype, null);
    assert.deepEqual(m.roles, []);
    assert.deepEqual(m.evidence, {});
    assert.equal(isEmptyOffer(m), true);
  }
});

test("normalizeOfferModel whitelists archetype and client kind, trims, dedupes and caps lists", () => {
  const m = normalizeOfferModel({
    archetype: "saas", clientKind: "both", sells: "  CRM \n software ", whoPays: "x".repeat(500),
    roles: ["Founder", "founder", " ", 5, "COO", "A", "B", "C", "D", "E"], locations: ["India", "india", "Tamil Nadu", "Kerala", "Goa"],
    webRelated: "yes",
  });
  assert.equal(m.archetype, "saas");
  assert.equal(m.clientKind, "both");
  assert.equal(m.sells, "CRM software");
  assert.equal(m.whoPays.length, 160);
  assert.equal(m.roles.length, 5);
  assert.deepEqual(m.roles.slice(0, 2), ["Founder", "COO"]);
  assert.equal(m.locations.length, 3);
  assert.equal(m.webRelated, false, "only a real boolean true counts");
  assert.equal(normalizeOfferModel({ archetype: "wizard", clientKind: "robots" }).archetype, null);
  assert.equal(normalizeOfferModel({ archetype: "wizard", clientKind: "robots" }).clientKind, null);
});

test("normalizeForMatch ignores case, runs of whitespace, nbsp and curly or straight quotes", () => {
  assert.equal(normalizeForMatch("  It’s  “Great”  "), normalizeForMatch("it's \"great\" "));
  assert.equal(normalizeForMatch("It’s  “Great”"), "its great");
});

test("a quote is found despite whitespace and case drift, and an ellipsis may skip text", () => {
  assert.equal(quoteInSources("custom software, CRM and automation for small businesses", [HOME]), true);
  assert.equal(quoteInSources("OUR CLINICS AND RETAIL CUSTOMERS lose deals", [HOME]), true);
  assert.equal(quoteInSources("Acme builds custom software ... in Tamil Nadu", [HOME]), true);
  assert.equal(quoteInSources("Acme builds mobile games for enterprises", [HOME]), false);
});

test("a quote that is too short or empty never counts as evidence", () => {
  assert.equal(quoteInSources("", [HOME]), false);
  assert.equal(quoteInSources("CRM", [HOME]), false);
  assert.equal(quoteInSources("... ...", [HOME]), false);
  assert.equal(quoteInSources("custom software", []), false);
});

test("locateQuote names the page the text was really found on", () => {
  assert.equal(locateQuote("founders and operations managers who need a CRM", [HOME, PRICING]), PRICING.url);
  assert.equal(locateQuote("custom software, CRM and automation", [HOME, PRICING]), HOME.url);
  assert.equal(locateQuote("nothing like this anywhere", [HOME, PRICING]), null);
});

test("enforceEvidence keeps evidenced fields and drops everything the pages do not support", () => {
  const raw = normalizeOfferModel({
    sells: "custom software", whoPays: "small businesses in Tamil Nadu",
    roles: ["Founder", "Operations Manager"], industries: ["Clinics", "Retail"], locations: ["Tamil Nadu"],
    problem: "Teams lose deals to spreadsheets.",
    evidence: {
      sells: { quote: "custom software, CRM and automation", url: "https://acme.example/" },
      whoPays: { quote: "small businesses in Tamil Nadu", url: "https://acme.example/" },
      roles: { quote: "founders and operations managers", url: "https://acme.example/pricing" },
      industries: { quote: "We serve Fortune 500 banks worldwide", url: "https://acme.example/" }, // invented
      // locations has a value but no evidence at all
    },
  });
  const { offer, dropped } = enforceEvidence(raw, [HOME, PRICING]);
  assert.equal(offer.sells, "custom software");
  assert.equal(offer.whoPays, "small businesses in Tamil Nadu");
  assert.deepEqual(offer.roles, ["Founder", "Operations Manager"]);
  assert.deepEqual(offer.industries, [], "an invented quote drops the value");
  assert.deepEqual(offer.locations, [], "a value with no quote is dropped");
  assert.equal(offer.problem, "", "no evidence entry means no value");
  assert.deepEqual([...dropped].sort(), ["industries", "locations", "problem"]);
  assert.equal(offer.evidence.industries, undefined);
  assert.deepEqual(offer.sources, [HOME.url, PRICING.url]);
});

test("enforceEvidence takes the evidence URL from the page it found, never from the model", () => {
  const raw = normalizeOfferModel({
    sells: "custom software",
    evidence: { sells: { quote: "custom software, CRM and automation", url: "javascript:alert(document.cookie)" } },
  });
  const { offer } = enforceEvidence(raw, [HOME]);
  assert.equal(offer.evidence.sells?.url, HOME.url);
});

test("enforceEvidence removes a leftover quote for a field that has no value", () => {
  const raw = normalizeOfferModel({ sells: "custom software", roles: [], evidence: { sells: { quote: "custom software, CRM and automation", url: "" }, roles: { quote: "founders and operations managers", url: "" } } });
  const { offer, dropped } = enforceEvidence(raw, [HOME, PRICING]);
  assert.equal(offer.evidence.roles, undefined);
  assert.deepEqual(dropped, []);
});

test("isEmptyOffer: only a model that knows nothing about who buys or what is sold is empty", () => {
  assert.equal(isEmptyOffer(emptyOfferModel()), true);
  assert.equal(isEmptyOffer(normalizeOfferModel({ archetype: "service", webRelated: true })), true);
  assert.equal(isEmptyOffer(normalizeOfferModel({ whoPays: "clinics" })), false);
  assert.equal(isEmptyOffer(normalizeOfferModel({ roles: ["CTO"] })), false);
});

test("archetypeLabel is plain language and never blank", () => {
  assert.equal(archetypeLabel(null), "Not clear from your site");
  for (const a of ["service", "saas", "creator", "local", "ecommerce", "other"] as const) assert.ok(archetypeLabel(a).length > 3);
});
