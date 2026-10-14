import test from "node:test";
import assert from "node:assert/strict";
import { enrichBusiness, extractContact, rankEmails } from "../lib/domain/leads/local/websiteContact.ts";
import { assertResolvesPublic } from "../lib/domain/net/ssrf.ts";

const PUBLIC = async () => [{ address: "93.184.216.34" }];
const PRIVATE = async () => [{ address: "10.0.0.5" }];

function page(html: string, type = "text/html; charset=utf-8"): Response {
  return new Response(html, { status: 200, headers: { "Content-Type": type } });
}

function fakeSite(routes: Record<string, () => Response>, calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request) => {
    const key = String(url);
    calls.push(key);
    const route = routes[key];
    if (!route) return new Response("nope", { status: 404 });
    return route();
  }) as typeof fetch;
}

test("extractContact reads mailto links first, drops junk, and prefers the site's own domain", () => {
  const html = `<html><body>
    <a href="mailto:hello@acme.example.com?subject=Hi">mail</a>
    <a href="mailto:noreply@acme.example.com">no</a>
    <p>Logo: logo@2x.png, tracker o1@o123.ingest.sentry.io, placeholder name@example.com</p>
    <p>Sales: sales@gmail.com</p>
    <p>Long: ${"a".repeat(90)}@x.example.com</p>
  </body></html>`;
  const out = extractContact(html, "https://acme.example.com/");
  assert.deepEqual(out.emails, ["hello@acme.example.com", "sales@gmail.com"]);
});

test("extractContact de-obfuscates bracketed forms and labelled spelled-out forms only", () => {
  const html = `<body><p>info [at] acme [dot] com</p><p>sales (at) acme (dot) com</p><p>Email: team at acme dot com</p></body>`;
  const out = extractContact(html, "https://acme.com/");
  assert.deepEqual(out.emails, ["info@acme.com", "sales@acme.com", "team@acme.com"]);
});

test("extractContact does not turn ordinary prose into an email", () => {
  const html = `<body><p>ask Jane at Acme dot com about pricing</p><p>we are at the mall dot store</p></body>`;
  assert.deepEqual(extractContact(html, "https://acme.com/").emails, []);
});

test("extractContact ignores scripts and styles when reading visible text", () => {
  const html = `<body><script>var x = "ghost@acme.com";</script><style>.a{}</style><p>real@acme.com</p></body>`;
  assert.deepEqual(extractContact(html, "https://acme.com").emails, ["real@acme.com"]);
});

test("extractContact finds WhatsApp numbers from wa.me, api.whatsapp.com and whatsapp:// links", () => {
  const cases: [string, string | null][] = [
    [`<a href="https://wa.me/15125550100?text=hi">x</a>`, "15125550100"],
    [`<a href="https://wa.me/+447700900123">x</a>`, "447700900123"],
    [`<a href="https://api.whatsapp.com/send?phone=15125550199&text=hi">x</a>`, "15125550199"],
    [`<a href="whatsapp://send?phone=%2B15125550177">x</a>`, "15125550177"],
    [`<a href="https://wa.me/123">too short</a>`, null],
    [`<a href="https://wa.me/1234567890123456789">too long</a>`, null],
  ];
  for (const [html, expected] of cases) {
    assert.equal(extractContact(`<body>${html}</body>`, "https://acme.com").whatsapp, expected, html);
  }
});

test("extractContact picks a same-host contact page and never an off-host one", () => {
  const html = `<body>
    <a href="https://elsewhere.example/contact">other</a>
    <a href="/about">About us</a>
    <a href="/contact-us">Contact</a>
    <a href="/">Home</a>
  </body>`;
  const out = extractContact(html, "https://acme.com/");
  assert.equal(out.contactUrl, "https://acme.com/contact-us");
});

test("extractContact reads a short description from meta tags and skips boilerplate", () => {
  const cookie = `<meta name="description" content="We use cookies to improve things.">`;
  const og = `<meta property="og:description" content="  Emergency   plumbing   across Austin,   open 24/7.  ">`;
  assert.equal(extractContact(`<head>${cookie}${og}</head>`, "https://acme.com").description, "Emergency plumbing across Austin, open 24/7.");
  const long = "word ".repeat(80);
  const description = extractContact(`<head><meta name="description" content="${long}"></head>`, "https://acme.com").description;
  assert.ok(description && description.length <= 200);
  assert.equal(extractContact(`<head><meta name="description" content="javascript required"></head>`, "https://acme.com").description, null);
});

test("extractContact never throws on bad base URLs", () => {
  assert.deepEqual(extractContact("<p>a@b.com</p>", "not a url"), { emails: [], whatsapp: null, contactUrl: null, description: null });
});

test("rankEmails keeps at most three and orders own-domain first", () => {
  const out = rankEmails(["a@other.net", "b@acme.com", "c@other.org", "d@sub.acme.com", "e@acme.com"], "www.acme.com");
  assert.deepEqual(out, ["b@acme.com", "d@sub.acme.com", "e@acme.com"]);
});

test("enrichBusiness returns no_website for a missing website without fetching", async () => {
  const calls: string[] = [];
  const out = await enrichBusiness(null, { fetchImpl: fakeSite({}, calls), lookup: PUBLIC });
  assert.equal(out.status, "no_website");
  assert.deepEqual(calls, []);
});

test("enrichBusiness reads the homepage and the contact page, at most three fetches", async () => {
  const calls: string[] = [];
  const routes = {
    "https://acme.com/": () => page(`<head><meta name="description" content="Plumbing in Austin."></head><body><a href="/contact">Contact</a><p>x</p></body>`),
    "https://acme.com/contact": () => page(`<body><a href="https://wa.me/15125550100">WA</a><p>team@acme.com</p></body>`),
  };
  const out = await enrichBusiness("acme.com", { fetchImpl: fakeSite(routes, calls), lookup: PUBLIC });
  assert.equal(out.status, "ok");
  assert.deepEqual(out.emails, ["team@acme.com"]);
  assert.equal(out.whatsapp, "15125550100");
  assert.equal(out.description, "Plumbing in Austin.");
  assert.equal(out.contactUrl, "https://acme.com/contact");
  assert.ok(calls.length <= 3);
});

test("assertResolvesPublic gives up on a DNS lookup that stalls past the timeout", async () => {
  const never = () => new Promise<{ address: string }[]>(() => {});
  const started = Date.now();
  await assert.rejects(assertResolvesPublic("slow.example.com", never, 25), { message: "That address can't be used." });
  assert.ok(Date.now() - started < 1000);
});

test("enrichBusiness blocks private addresses before any fetch", async () => {
  const calls: string[] = [];
  const out = await enrichBusiness("http://internal.example", { fetchImpl: fakeSite({}, calls), lookup: PRIVATE });
  assert.equal(out.status, "blocked");
  assert.deepEqual(calls, []);
  const literal = await enrichBusiness("http://127.0.0.1/", { fetchImpl: fakeSite({}, calls), lookup: PUBLIC });
  assert.equal(literal.status, "blocked");
});

test("enrichBusiness refuses a redirect to another host, and checks each hop", async () => {
  const calls: string[] = [];
  const routes = {
    "https://acme.com/": () => new Response("", { status: 302, headers: { location: "https://evil.example/home" } }),
  };
  const out = await enrichBusiness("https://acme.com", { fetchImpl: fakeSite(routes, calls), lookup: PUBLIC });
  assert.equal(out.status, "failed");
  assert.deepEqual(calls, ["https://acme.com/"]);
});

test("enrichBusiness re-checks DNS on every hop and reports blocked when a later hop resolves private", async () => {
  const routes = {
    "https://acme.com/": () => new Response("", { status: 302, headers: { location: "https://acme.com/inner" } }),
  };
  let lookups = 0;
  // First resolution is public (the homepage), the second (the redirect hop) is private: DNS rebinding shape.
  const lookup = async () => {
    lookups += 1;
    return lookups === 1 ? [{ address: "93.184.216.34" }] : [{ address: "10.1.1.1" }];
  };
  const calls: string[] = [];
  const out = await enrichBusiness("https://acme.com", { fetchImpl: fakeSite(routes, calls), lookup });
  assert.equal(out.status, "blocked");
  assert.deepEqual(calls, ["https://acme.com/"]);
});

test("enrichBusiness fails for non-HTML and HTTP errors and never throws", async () => {
  const pdf = { "https://acme.com/": () => page("%PDF", "application/pdf") };
  assert.equal((await enrichBusiness("https://acme.com", { fetchImpl: fakeSite(pdf), lookup: PUBLIC })).status, "failed");
  const broken = (async () => {
    throw new Error("boom");
  }) as typeof fetch;
  assert.equal((await enrichBusiness("https://acme.com", { fetchImpl: broken, lookup: PUBLIC })).status, "failed");
  assert.equal((await enrichBusiness("ht!tp://%%%", { lookup: PUBLIC })).status, "failed");
});

test("enrichBusiness sends no cookies and caps the body size", async () => {
  let headers: Record<string, string> = {};
  let init: RequestInit | undefined;
  const big = "x".repeat(600_000);
  const fakeFetch = (async (_url: string | URL | Request, i?: RequestInit) => {
    init = i;
    headers = i?.headers as Record<string, string>;
    return page(`<body>${big}</body>`);
  }) as typeof fetch;
  const out = await enrichBusiness("https://acme.com", { fetchImpl: fakeFetch, lookup: PUBLIC });
  assert.equal(out.status, "ok");
  assert.equal(init?.redirect, "manual");
  assert.equal(headers.Cookie, undefined);
  assert.equal(headers.cookie, undefined);
});
