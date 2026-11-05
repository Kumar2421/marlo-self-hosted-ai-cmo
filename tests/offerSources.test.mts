import test from "node:test";
import assert from "node:assert/strict";
import { gatherOfferSources, type AuditForOffer, type CrawlFn } from "../lib/domain/offer/offerSources.ts";

const audit = (over: Partial<AuditForOffer> = {}): AuditForOffer => ({
  url: "https://acme.example/",
  meta: { title: "Acme", description: "Custom software" },
  bodyText: "We build CRM and automation for small businesses.",
  links: [
    { href: "https://acme.example/pricing", text: "Pricing", internal: true },
    { href: "https://acme.example/careers", text: "Careers", internal: true },
  ],
  ...over,
});

test("the homepage text always comes first, joining title, description and body", async () => {
  const sources = await gatherOfferSources(audit({ links: [] }), async () => []);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "https://acme.example/");
  assert.match(sources[0].text, /Acme\nCustom software\nWe build CRM/);
});

test("only the key pages are crawled and their text is appended after the homepage", async () => {
  let asked: string[] = [];
  const crawl: CrawlFn = async (links) => {
    asked = links.map((l) => l.href);
    return [{ url: "https://acme.example/pricing", content: "Plans for founders" }];
  };
  const sources = await gatherOfferSources(audit(), crawl);
  assert.deepEqual(asked, ["https://acme.example/pricing"]);
  assert.deepEqual(sources.map((s) => s.url), ["https://acme.example/", "https://acme.example/pricing"]);
});

test("no key pages means no crawl at all", async () => {
  let calls = 0;
  await gatherOfferSources(audit({ links: [{ href: "https://acme.example/careers", internal: true }] }), async () => {
    calls += 1;
    return [];
  });
  assert.equal(calls, 0);
});

test("a crawl that throws never fails the step: the homepage is still returned", async () => {
  const sources = await gatherOfferSources(audit(), async () => {
    throw new Error("boom");
  });
  assert.equal(sources.length, 1);
});

test("a crawl slower than the budget is abandoned and the homepage is used", async () => {
  const slow: CrawlFn = () => new Promise((resolve) => setTimeout(() => resolve([{ url: "https://acme.example/pricing", content: "late" }]), 400));
  const started = Date.now();
  const sources = await gatherOfferSources(audit(), slow, 30);
  assert.equal(sources.length, 1);
  assert.ok(Date.now() - started < 300, "returned at the budget, not when the crawl finished");
});

test("blank pages are skipped, and an empty audit gives no sources", async () => {
  const crawl: CrawlFn = async () => [{ url: "https://acme.example/pricing", content: "   " }];
  assert.equal((await gatherOfferSources(audit(), crawl)).length, 1);
  const none = await gatherOfferSources(audit({ meta: { title: "", description: "" }, bodyText: "", links: [] }), async () => []);
  assert.deepEqual(none, []);
});

test("a redirected site is read from where it ended up", async () => {
  const sources = await gatherOfferSources(audit({ finalUrl: "https://www.acme.example/", links: [] }), async () => []);
  assert.equal(sources[0].url, "https://www.acme.example/");
});
