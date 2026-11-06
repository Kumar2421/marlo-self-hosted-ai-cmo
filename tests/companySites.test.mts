import test from "node:test";
import assert from "node:assert/strict";
import { companyNameFrom, hostOf, pickCompanySites } from "../lib/domain/leads/company/companySites.ts";

const hit = (url: string, title = "Acme Clinic | Chennai", content = "Family clinic") => ({ url, title, content });

test("keeps real company sites, one homepage per company, www folded", () => {
  const out = pickCompanySites([hit("https://www.acme.test/about"), hit("https://acme.test/pricing"), hit("https://beta.test/")]);
  assert.deepEqual(out.map((c) => c.host), ["acme.test", "beta.test"]);
  assert.equal(out[0].website, "https://acme.test/");
});

test("drops social, directories, marketplaces and their subdomains", () => {
  const out = pickCompanySites([hit("https://www.linkedin.com/company/acme"), hit("https://in.linkedin.com/in/x"), hit("https://www.justdial.com/Chennai/clinics"), hit("https://acme.test/")]);
  assert.deepEqual(out.map((c) => c.host), ["acme.test"]);
});

test("drops listicles and comparison pages", () => {
  const out = pickCompanySites([hit("https://blog.test/x", "Top 10 clinics in Chennai"), hit("https://blog2.test/y", "Best marketing agencies in India"), hit("https://real.test/", "Real Clinic")]);
  assert.deepEqual(out.map((c) => c.host), ["real.test"]);
});

test("never returns the user's own site, excluded hosts, or hosts already saved", () => {
  const out = pickCompanySites([hit("https://mine.test/"), hit("https://app.mine.test/"), hit("https://rival.test/"), hit("https://known.test/"), hit("https://new.test/")], {
    excludeHosts: ["mine.test", "rival.test"], knownHosts: new Set(["known.test"]),
  });
  assert.deepEqual(out.map((c) => c.host), ["new.test"]);
});

test("javascript: and junk URLs are ignored; max caps the list", () => {
  assert.equal(hostOf("javascript:alert(1)"), null);
  assert.equal(pickCompanySites([hit("javascript:x"), hit("not a url")]).length, 0);
  assert.equal(pickCompanySites(Array.from({ length: 30 }, (_, i) => hit(`https://c${i}.test/`)), { max: 5 }).length, 5);
});

test("company name comes from the title's first segment, else the host", () => {
  assert.equal(companyNameFrom("Acme Clinic | Chennai", "acme.test"), "Acme Clinic");
  assert.equal(companyNameFrom("", "acme.test"), "Acme");
  assert.equal(companyNameFrom("x".repeat(90), "acme.test"), "Acme");
});
