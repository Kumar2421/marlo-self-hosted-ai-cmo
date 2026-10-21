import test from "node:test";
import assert from "node:assert/strict";
import { isHostLike, normalizeHostUrl } from "../lib/domain/shared/hostLike.ts";
import { createFaviconLoader } from "../lib/domain/shared/faviconClient.ts";

test("normalizeHostUrl adds https:// to bare hosts and keeps explicit http(s)", () => {
  assert.deepEqual(normalizeHostUrl("Marlo.mlforge.in"), { url: "https://marlo.mlforge.in/", host: "marlo.mlforge.in" });
  assert.equal(normalizeHostUrl("  acme.com/pricing ")?.url, "https://acme.com/pricing");
  assert.equal(normalizeHostUrl("http://acme.com")?.url, "http://acme.com/");
  assert.equal(normalizeHostUrl("https://www.acme.co.uk:443/x")?.host, "www.acme.co.uk");
  assert.equal(normalizeHostUrl("https://xn--bcher-kva.example/")?.host, "xn--bcher-kva.example");
});

test("normalizeHostUrl rejects values that are not websites", () => {
  for (const v of ["", "   ", "Marlo", "my competitor", "acme", "localhost", "127.0.0.1", "ftp://acme.com", "javascript:alert(1)", "mailto:a@b.com", "https://user:pw@acme.com", "acme.c", "acme.123", "-a.com", "a..com", "http://", "x".repeat(3000) + ".com"]) {
    assert.equal(normalizeHostUrl(v), null, JSON.stringify(v.slice(0, 30)));
  }
  assert.equal(normalizeHostUrl(undefined), null);
  assert.equal(normalizeHostUrl(42), null);
  assert.equal(isHostLike("acme.com."), true);
  assert.equal(isHostLike("acme"), false);
});

function fakeFetch(handler: (url: string) => { ok: boolean; body?: unknown } | Error) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const r = handler(url);
    if (r instanceof Error) throw r;
    return { ok: r.ok, json: async () => r.body };
  };
  return { fn, calls };
}

test("loader: non host-like values never reach fetch", async () => {
  const f = fakeFetch(() => ({ ok: true, body: { favicon: "data:image/png;base64,AA" } }));
  const loader = createFaviconLoader(f.fn);
  assert.equal(await loader.load("Marlo"), null);
  assert.equal(await loader.load(""), null);
  assert.equal(loader.peek("Marlo"), null);
  assert.equal(f.calls.length, 0);
});

test("loader: concurrent and repeated loads for one host make one request", async () => {
  const f = fakeFetch(() => ({ ok: true, body: { favicon: "data:image/png;base64,AA" } }));
  const loader = createFaviconLoader(f.fn);
  assert.equal(loader.peek("acme.com"), undefined);
  const r = await Promise.all([loader.load("acme.com"), loader.load("https://acme.com/"), loader.load("ACME.com/pricing")]);
  assert.deepEqual(r, Array(3).fill("data:image/png;base64,AA"));
  assert.equal(await loader.load("acme.com"), "data:image/png;base64,AA");
  assert.equal(loader.peek("acme.com"), "data:image/png;base64,AA");
  assert.equal(f.calls.length, 1);
});

test("loader: failures (400, network error, bad body) are remembered and not retried", async () => {
  const f = fakeFetch((u) => (u.includes("neterr") ? new Error("offline") : u.includes("badbody") ? { ok: true, body: null } : { ok: false }));
  const loader = createFaviconLoader(f.fn);
  for (const host of ["bad.example", "neterr.example", "badbody.example"]) {
    assert.equal(await loader.load(host), null);
    assert.equal(await loader.load(host), null);
    assert.equal(loader.peek(host), null);
  }
  assert.equal(f.calls.length, 3);
});
