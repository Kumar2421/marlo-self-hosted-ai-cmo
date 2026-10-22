import test from "node:test";
import assert from "node:assert/strict";
import {
  brandFromTitle, decideAutoRename, deriveNameFromUrl, isAutoDerivedName, pickProjectName, registrableLabel,
} from "../lib/domain/project/projectName.ts";

test("deriveNameFromUrl table", () => {
  const rows: [string, string][] = [
    ["home.mlforge.in", "Mlforge"],
    ["https://www.acme.co.uk/pricing?x=1", "Acme"],
    ["app.stripe.com", "Stripe"],
    ["shop.example.com", "Example"],
    ["https://blog.my-startup.io:8080/a/b", "My Startup"],
    ["portal.company.com.au", "Company"],
    ["acme.co.in", "Acme"],
    ["localhost", "Localhost"],
    ["https://münchen-app.de", "München App"],
    ["xn--mnchen-3ya.de", "München"],
    ["HTTPS://WWW.Example.COM", "Example"],
  ];
  for (const [input, want] of rows) assert.equal(deriveNameFromUrl(input), want, input);
});

test("registrableLabel handles two-level suffixes", () => {
  assert.equal(registrableLabel("a.b.acme.co.uk"), "acme");
  assert.equal(registrableLabel("home.mlforge.in"), "mlforge");
  assert.equal(registrableLabel("co.uk"), "co");
});

test("brandFromTitle", () => {
  assert.equal(brandFromTitle("Acme | Invoicing"), "Acme");
  assert.equal(brandFromTitle("Home - MLForge Studio"), "MLForge Studio");
  assert.equal(brandFromTitle("Home | Welcome"), null);
  assert.equal(brandFromTitle("MLForge Studio – Enterprise AI"), "MLForge Studio");
  assert.equal(brandFromTitle(""), null);
  assert.equal(brandFromTitle("A very long marketing tagline that is certainly not a brand name at all"), null);
});

test("pickProjectName prefers og:site_name, then title, then domain", () => {
  assert.equal(pickProjectName({ url: "shop.example.com", siteName: "Example Store Co", title: "Buy | Stuff" }), "Example Store Co");
  assert.equal(pickProjectName({ url: "home.mlforge.in", title: "Home | MLForge Studio" }), "MLForge Studio");
  assert.equal(pickProjectName({ url: "home.mlforge.in", siteName: "Home", title: "Home" }), "Mlforge");
  assert.equal(pickProjectName({ url: "acme.com", title: "Acme | Invoicing" }), "Acme");
});

test("isAutoDerivedName recognises generated names only", () => {
  assert.ok(isAutoDerivedName("Home", "home.mlforge.in"));
  assert.ok(isAutoDerivedName("Mlforge", "home.mlforge.in"));
  assert.ok(!isAutoDerivedName("My Studio", "home.mlforge.in"));
});

test("decideAutoRename renames only an auto-derived name", () => {
  const audit = { meta: { title: "Home | MLForge Studio" }, openGraph: [{ key: "og:site_name", value: "MLForge Studio" }] };
  assert.equal(decideAutoRename("Home", "https://home.mlforge.in", audit), "MLForge Studio");
  assert.equal(decideAutoRename("Mlforge", "https://home.mlforge.in", audit), "MLForge Studio");
  assert.equal(decideAutoRename("My own name", "https://home.mlforge.in", audit), null);
  assert.equal(decideAutoRename("MLForge Studio", "https://home.mlforge.in", audit), null);
  assert.equal(decideAutoRename("Home", "https://home.mlforge.in", null), null);
  // Nothing better on the page: falls back to the domain brand, but never to the same name.
  assert.equal(decideAutoRename("Mlforge", "https://home.mlforge.in", { meta: { title: "Home" } }), null);
});
