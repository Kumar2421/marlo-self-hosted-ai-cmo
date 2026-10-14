import test from "node:test";
import assert from "node:assert/strict";
import {
  categoryFromQuery,
  tagsLiteral,
  emailLabel,
  enrichmentNote,
  leadChips,
  ratingLabel,
  sortByFitScore,
  statusFromTags,
  suggestCategory,
  suggestLocation,
  tagsWithStatus,
  telLink,
  websiteHref,
  whatsappLink,
} from "../lib/domain/leads/local/businessLead.ts";

test("whatsappLink keeps only digits for wa.me", () => {
  assert.equal(whatsappLink("+1 (512) 555-0100"), "https://wa.me/15125550100");
  assert.equal(whatsappLink("15125550100"), "https://wa.me/15125550100");
  assert.equal(whatsappLink("44 20 7946 0958"), "https://wa.me/442079460958");
});

test("whatsappLink rejects numbers that are too short or too long", () => {
  assert.equal(whatsappLink("12345"), null);
  assert.equal(whatsappLink("1234567890123456"), null);
  assert.equal(whatsappLink(""), null);
  assert.equal(whatsappLink(null), null);
});

test("telLink keeps one leading plus and the digits", () => {
  assert.equal(telLink("+1 (512) 555-0100"), "tel:+15125550100");
  assert.equal(telLink("(512) 555-0100"), "tel:5125550100");
  assert.equal(telLink("555"), null);
  assert.equal(telLink(null), null);
});

test("websiteHref only allows http and https", () => {
  assert.equal(websiteHref("example.com"), "https://example.com/");
  assert.equal(websiteHref("https://example.com/contact"), "https://example.com/contact");
  assert.equal(websiteHref("javascript:alert(1)"), null);
  assert.equal(websiteHref("data:text/html,hi"), null);
  assert.equal(websiteHref("  "), null);
});

test("suggestCategory takes the first industry and drops generic trailing words", () => {
  assert.equal(suggestCategory(["Dental clinics", "Gyms"]), "Dental clinics");
  assert.equal(suggestCategory(["Plumbing companies"]), "Plumbing");
  assert.equal(suggestCategory(["  Coffee   shops  "]), "Coffee shops");
  assert.equal(suggestCategory([" ", ""]), "");
  assert.equal(suggestCategory([]), "");
  assert.equal(suggestCategory(null), "");
});

test("suggestLocation takes the first location or nothing", () => {
  assert.equal(suggestLocation(["Austin, TX", "Dallas, TX"]), "Austin, TX");
  assert.equal(suggestLocation([]), "");
  assert.equal(suggestLocation([" "]), "");
});

test("emailLabel is honest about what was confirmed", () => {
  assert.equal(emailLabel("source_found"), "Email found on website");
  assert.equal(emailLabel("domain_found"), "Email found on website - domain accepts mail, not confirmed");
  assert.equal(emailLabel("unknown"), "Email found on website - mail server not confirmed");
  assert.equal(emailLabel(null), null);
  assert.equal(emailLabel("verified"), null);
});

test("leadChips lists only what was found, in a fixed order", () => {
  const chips = leadChips({
    phone: "555",
    whatsapp: "15125550100",
    email: "hi@example.com",
    website: "https://example.com",
    contact_url: "https://example.com/contact",
  });
  assert.deepEqual(
    chips.map((c) => c.key),
    ["phone", "whatsapp", "email", "website", "contact"]
  );
  assert.deepEqual(leadChips({}), []);
});

test("leadChips skips a WhatsApp value that cannot become a link, and an unsafe website", () => {
  const chips = leadChips({ whatsapp: "12", website: "javascript:alert(1)" });
  assert.deepEqual(chips, []);
});

test("statusFromTags reads the status tag and defaults to new", () => {
  assert.equal(statusFromTags(null), "new");
  assert.equal(statusFromTags(["vip"]), "new");
  assert.equal(statusFromTags(["vip", "status:contacted"]), "contacted");
  assert.equal(statusFromTags(["status:bogus"]), "new");
});

test("tagsWithStatus replaces the old status and keeps other tags", () => {
  assert.deepEqual(tagsWithStatus(["vip", "status:contacted"], "replied"), ["vip", "status:replied"]);
  assert.deepEqual(tagsWithStatus(["vip", "status:contacted"], "new"), ["vip"]);
  assert.deepEqual(tagsWithStatus(null, "not_interested"), ["status:not_interested"]);
});

test("ratingLabel formats stars and review counts", () => {
  assert.equal(ratingLabel(4.5, 1234), "4.5 (1,234 reviews)");
  assert.equal(ratingLabel(5, 1), "5.0 (1 review)");
  assert.equal(ratingLabel(4, 0), "4.0");
  assert.equal(ratingLabel(null, 10), null);
});

test("categoryFromQuery splits the stored query on the last ' in '", () => {
  assert.equal(categoryFromQuery("dentist in Austin, TX"), "dentist");
  assert.equal(categoryFromQuery("coffee shop in Main in Austin"), "coffee shop in Main");
  assert.equal(categoryFromQuery("dentist"), "dentist");
  assert.equal(categoryFromQuery(null), "");
});

test("enrichmentNote explains skipped and failed website checks", () => {
  assert.equal(enrichmentNote("ok"), null);
  assert.equal(enrichmentNote("no_website"), null);
  assert.match(enrichmentNote("skipped") ?? "", /not checked/);
});

test("sortByFitScore sorts high to low, treats missing as 0, and is stable", () => {
  const items = [
    { id: "a", fit_score: 10 },
    { id: "b", fit_score: null },
    { id: "c", fit_score: 40 },
    { id: "d", fit_score: 10 },
  ];
  assert.deepEqual(
    sortByFitScore(items).map((i) => i.id),
    ["c", "a", "d", "b"]
  );
});

test("tagsLiteral builds an exact Postgres text[] literal, escaping quotes and backslashes", () => {
  assert.equal(tagsLiteral([]), "{}");
  assert.equal(tagsLiteral(["status:new", "vip"]), '{"status:new","vip"}');
  assert.equal(tagsLiteral(['a"b', "c\\d"]), '{"a\\"b","c\\\\d"}');
});
