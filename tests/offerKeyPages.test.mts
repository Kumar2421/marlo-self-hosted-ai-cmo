import test from "node:test";
import assert from "node:assert/strict";
import { pickKeyPageLinks } from "../lib/domain/offer/keyPages.ts";

const SITE = "https://www.acme.example/";
const link = (href: string, text = "", internal = true) => ({ href, text, internal });

test("picks pricing, services and about pages, strongest signal first", () => {
  const picked = pickKeyPageLinks(SITE, [
    link("https://acme.example/about"),
    link("https://acme.example/services"),
    link("https://acme.example/pricing"),
    link("https://acme.example/blog/hello"),
  ]);
  assert.deepEqual(picked, ["https://acme.example/pricing", "https://acme.example/services", "https://acme.example/about"]);
});

test("customer, case study and industry pages count; unrelated pages and the homepage do not", () => {
  const picked = pickKeyPageLinks(SITE, [
    link("https://acme.example/"),
    link("https://acme.example/case-studies/clinic"),
    link("https://acme.example/industries/retail"),
    link("https://acme.example/careers"),
    link("https://acme.example/blog/news"),
  ]);
  assert.deepEqual(picked, ["https://acme.example/case-studies/clinic", "https://acme.example/industries/retail"]);
});

test("link text can carry the signal when the path does not", () => {
  const picked = pickKeyPageLinks(SITE, [link("https://acme.example/p/42", "Pricing"), link("https://acme.example/p/43", "Careers")]);
  assert.deepEqual(picked, ["https://acme.example/p/42"]);
});

test("external hosts, assets, account pages, anchors and non-web links are never picked", () => {
  const picked = pickKeyPageLinks(SITE, [
    link("https://other.example/pricing"),
    link("https://acme.example/pricing.pdf"),
    link("https://acme.example/login"),
    link("https://acme.example/privacy"),
    link("mailto:hi@acme.example"),
    link("https://acme.example/#pricing"),
    link("https://acme.example/pricing", "", false),
    link("not a url"),
  ]);
  assert.deepEqual(picked, []);
});

test("the www prefix does not make the same site look external, and duplicates collapse", () => {
  const picked = pickKeyPageLinks("https://acme.example/", [
    link("https://www.acme.example/pricing"),
    link("https://acme.example/pricing#faq"),
    link("https://acme.example/pricing/"),
  ]);
  assert.deepEqual(picked, ["https://www.acme.example/pricing"], "www, trailing slash and fragment are all the same page");
});

test("max limits the result, ties keep page order, and bad input is safe", () => {
  const links = ["a", "b", "c", "d"].map((n) => link(`https://acme.example/services/${n}`));
  assert.deepEqual(pickKeyPageLinks(SITE, links, 2), ["https://acme.example/services/a", "https://acme.example/services/b"]);
  assert.deepEqual(pickKeyPageLinks(SITE, links, 0), []);
  assert.deepEqual(pickKeyPageLinks("not a url", links), []);
  assert.deepEqual(pickKeyPageLinks(SITE, []), []);
});
