import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { isPrivateIp } from "../lib/domain/net/ssrf.ts";
import { safeFetch } from "../lib/domain/net/safeFetch.ts";
import { assertProviderBaseUrl } from "../lib/domain/net/providerBaseUrl.ts";
import { jinaRead } from "../lib/domain/shared/jinaReader.ts";
import { FaviconCache } from "../lib/domain/shared/faviconFetch.ts";
import { createFixedWindowLimiter } from "../lib/domain/shared/fixedWindowLimiter.ts";
import { publishWordPressPost, sameHostLink } from "../lib/domain/cms/wordpressPost.ts";
import { assertPublicCmsUrl } from "../lib/domain/cms/cmsFetch.ts";
import { CmsError } from "../lib/domain/cms/cmsFixCatalog.ts";
import { fakeFetch, PUBLIC_ADDR, publicLookup } from "./support/cmsTransport.mts";

const baseGuard = (raw: string): URL => {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http/https URLs are allowed");
  return u;
};
const assertUrl = (u: string) => void assertPublicCmsUrl(u, baseGuard);

// ---- IPv6 embedded and translated forms (finding 4) ----------------------------------------

test("IPv6: translated, 6to4, site-local, Teredo and local-use NAT64 forms that embed private space are rejected", () => {
  for (const ip of ["::ffff:0:a9fe:a9fe", "2002:a9fe:a9fe::", "2002:7f00:1::", "fec0::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "64:ff9b:1::1", "::ffff:0:127.0.0.1", "2002:0a00:0001::"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
});

test("IPv6: real public addresses, including public 6to4 and translated forms, still pass", () => {
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "2002:0808:0808::", "::ffff:0:0808:0808"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

// ---- provider base URL policy (finding 1a) ------------------------------------------------

const PUBLIC_LOOKUP = publicLookup({ "shop.example": [PUBLIC_ADDR], "mixed.example": [PUBLIC_ADDR, "10.0.0.5"] });

test("provider base URL: hosted mode rejects private and loopback addresses for every provider", async () => {
  for (const id of ["ollama", "lmstudio", "custom", "openai", "wordpress", "webflow"]) {
    await assert.rejects(assertProviderBaseUrl(id, "http://localhost:11434", { platformMode: true, lookup: PUBLIC_LOOKUP }), Error, id);
    await assert.rejects(assertProviderBaseUrl(id, "http://169.254.169.254/latest", { platformMode: true, lookup: PUBLIC_LOOKUP }), Error, id);
  }
  await assertProviderBaseUrl("openai", "https://shop.example/v1", { platformMode: true, lookup: PUBLIC_LOOKUP });
});

test("provider base URL: self-host allows localhost only for local model servers", async () => {
  for (const id of ["ollama", "lmstudio", "custom"]) {
    await assertProviderBaseUrl(id, "http://localhost:11434", { platformMode: false, lookup: PUBLIC_LOOKUP });
    await assertProviderBaseUrl(id, "http://127.0.0.1:1234/v1", { platformMode: false, lookup: PUBLIC_LOOKUP });
  }
  for (const id of ["wordpress", "webflow", "openai"]) {
    await assert.rejects(assertProviderBaseUrl(id, "http://localhost/", { platformMode: false, lookup: PUBLIC_LOOKUP }), Error, id);
  }
  // Local providers still refuse credentials and non-http schemes.
  await assert.rejects(assertProviderBaseUrl("ollama", "http://user:pw@localhost/", { platformMode: false }), /username and password/);
  await assert.rejects(assertProviderBaseUrl("ollama", "file:///etc/passwd", { platformMode: false }), /valid website URL/);
});

test("provider base URL: a name with any private answer is rejected for outbound providers", async () => {
  await assert.rejects(assertProviderBaseUrl("wordpress", "https://mixed.example/", { platformMode: false, lookup: PUBLIC_LOOKUP }), Error);
  await assertProviderBaseUrl("wordpress", "https://shop.example/blog", { platformMode: false, lookup: PUBLIC_LOOKUP });
});

// ---- WordPress publish (finding 1b, 1c) -----------------------------------------------------

test("WordPress publish: Basic auth goes only to the connected host, and redirects to another host are refused", async () => {
  const net = fakeFetch(() => ({ status: 302, headers: { location: "https://attacker.example/wp-json/wp/v2/posts" } }));
  await assert.rejects(
    publishWordPressPost({ baseUrl: "https://shop.example/", credentials: "bob:app-pass", title: "T", html: "<p>x</p>" }, { assertUrl, ...net.net }),
    (e: unknown) => e instanceof CmsError && /different host/.test((e as Error).message),
  );
  assert.equal(net.calls.length, 1, "credentials are not repeated to the other host");
  assert.equal(net.calls[0].url, "https://shop.example/wp-json/wp/v2/posts");
  assert.equal(net.calls[0].headers.Authorization, `Basic ${Buffer.from("bob:app-pass").toString("base64")}`);
});

test("WordPress publish: upstream bodies are never echoed; the error is the fixed rejection text", async () => {
  const net = fakeFetch(() => ({ status: 401, body: { message: "SECRET-LEAK-VALUE rest_forbidden" } }));
  await assert.rejects(
    publishWordPressPost({ baseUrl: "https://shop.example", credentials: "a:b", title: "T", html: "x" }, { assertUrl, ...net.net }),
    (e: unknown) => e instanceof CmsError && (e as Error).message === "WordPress rejected the post (HTTP 401).",
  );
});

test("WordPress publish: data.link is kept only when it is http(s) on the connected host", async () => {
  assert.equal(sameHostLink("https://shop.example/hello/", "https://shop.example"), "https://shop.example/hello/");
  assert.equal(sameHostLink("https://evil.example/hello/", "https://shop.example"), null);
  assert.equal(sameHostLink("javascript:alert(1)", "https://shop.example"), null);
  assert.equal(sameHostLink("ftp://shop.example/x", "https://shop.example"), null);
  assert.equal(sameHostLink(42, "https://shop.example"), null);

  const good = fakeFetch(() => ({ status: 201, body: { link: "https://shop.example/hello/" } }));
  assert.deepEqual(await publishWordPressPost({ baseUrl: "https://shop.example", credentials: "a:b", title: "T", html: "x" }, { assertUrl, ...good.net }), { publishedUrl: "https://shop.example/hello/" });
  const evil = fakeFetch(() => ({ status: 201, body: { link: "https://evil.example/phish" } }));
  assert.deepEqual(await publishWordPressPost({ baseUrl: "https://shop.example", credentials: "a:b", title: "T", html: "x" }, { assertUrl, ...evil.net }), { publishedUrl: null });
});

// ---- safeFetch authorization and body --------------------------------------------------------

test("safeFetch: the authorization option reaches only the first origin, and a caller Authorization header never does", async () => {
  const f = fakeFetch((c) => (c.url.startsWith("https://a.test") ? { status: 302, headers: { location: "https://b.test/x" } } : { body: { ok: 1 } }));
  const res = await safeFetch("https://a.test/start", {
    ...f.net,
    method: "POST",
    body: "{\"k\":1}",
    authorization: "Basic first-only",
    headers: { Authorization: "Basic caller-value", "Content-Type": "application/json" },
  });
  assert.equal(res.status, 200);
  assert.equal(f.calls[0].headers.Authorization, "Basic first-only");
  assert.equal(f.calls[0].body, "{\"k\":1}");
  assert.equal(f.calls[0].headers["content-length"], String(Buffer.byteLength("{\"k\":1}")));
  assert.equal(f.calls[1].url, "https://b.test/x");
  assert.equal(f.calls[1].method, "GET", "a 302 on the followed hop is a GET");
  assert.equal(f.calls[1].headers.Authorization, undefined, "never forwarded across origins");
});

// ---- jina: validation before sending, encoded target (finding 5) ----------------------------

test("jina: a non-public target is never sent to r.jina.ai", async () => {
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (url: string) => {
    sent.push(String(url));
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  try {
    assert.equal(await jinaRead("http://127.0.0.1:8080/admin"), null);
    assert.equal(await jinaRead("https://mixed.example/x", PUBLIC_LOOKUP), null);
    assert.equal(sent.length, 0);
    await jinaRead("https://shop.example/a?b=c&d=e", PUBLIC_LOOKUP);
    assert.equal(sent.length, 1);
    assert.equal(sent[0], `https://r.jina.ai/${encodeURIComponent("https://shop.example/a?b=c&d=e")}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---- favicon cache bounds (finding 3) -------------------------------------------------------

test("favicon cache: entry count is capped and the least recently used entry is evicted", () => {
  const c = new FaviconCache({ maxEntries: 2, maxTotalChars: 1_000, maxEntryChars: 100, ttlMs: 60_000 });
  c.set("a.test", "data:a");
  c.set("b.test", "data:b");
  assert.equal(c.get("a.test"), "data:a"); // a is now the most recently used
  c.set("c.test", "data:c");
  assert.equal(c.size, 2);
  assert.equal(c.get("b.test"), undefined, "b was the least recently used");
  assert.equal(c.get("a.test"), "data:a");
  assert.equal(c.get("c.test"), "data:c");
});

test("favicon cache: total size is capped, oversized icons are not cached, and null results are cached", () => {
  const c = new FaviconCache({ maxEntries: 200, maxTotalChars: 10, maxEntryChars: 6, ttlMs: 60_000 });
  c.set("big.test", "data:1234567"); // 12 chars: over the per-entry cap, dropped
  assert.equal(c.get("big.test"), undefined);
  c.set("a.test", "12345");
  c.set("b.test", "567890");
  assert.ok(c.charCount <= 10);
  assert.equal(c.get("a.test"), undefined, "the total cap evicted the oldest entry");
  c.set("none.test", null);
  assert.equal(c.get("none.test"), null, "a 'no icon' answer is remembered");
  assert.ok(c.charCount <= 10);
});

test("favicon cache: entries expire after the TTL", () => {
  let now = 1_000;
  const c = new FaviconCache({ ttlMs: 3_600_000, now: () => now });
  c.set("a.test", "data:a");
  now += 3_599_999;
  assert.equal(c.get("a.test"), "data:a");
  now += 2;
  assert.equal(c.get("a.test"), undefined);
  assert.equal(c.size, 0);
  assert.equal(c.charCount, 0);
});

// ---- bounded rate limiter (finding 3, favicon route) ----------------------------------------

test("fixed-window limiter: a key is limited within its window, and the key set stays bounded", () => {
  let now = 0;
  const allow = createFixedWindowLimiter({ limit: 1, windowMs: 1_000, maxKeys: 2, now: () => now });
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  assert.equal(allow("b"), true);
  // A third key evicts the oldest entry ("a") to stay within maxKeys, so "a" starts over.
  assert.equal(allow("c"), true);
  assert.equal(allow("a"), true, "evicted keys are not remembered forever");
  now += 1_000;
  assert.equal(allow("c"), true, "a new window resets the count");
});

// ---- audit limiter keying is not spoofable (finding 6) --------------------------------------

test("audit route key: only the platform-set x-real-ip is trusted, and the map is bounded", () => {
  const src = readFileSync(new URL("../app/api/public/audit/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /get\("x-forwarded-for"\)/, "the audit route must not key on x-forwarded-for");
  assert.match(src, /process\.env\.VERCEL\)\s*return req\.headers\.get\("x-real-ip"\)/);
  assert.match(src, /MAX_TRACKED_KEYS = 10_000/);
});
