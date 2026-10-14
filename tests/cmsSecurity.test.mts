import test from "node:test";
import assert from "node:assert/strict";
import { CmsError, type CmsChange, type CmsItemRef } from "../lib/domain/cms/cmsFixCatalog.ts";
import { issueCmsTicket, liveBeforeMatches, redeemCmsTicket, reviseCmsTicket } from "../lib/domain/cms/cmsTicket.ts";
import { assertPublicCmsUrl, cmsFetch } from "../lib/domain/cms/cmsFetch.ts";
import { fakeFetch, PUBLIC_ADDR } from "./support/cmsTransport.mts";
import { WordPressPublisher } from "../lib/domain/cms/wordpressPublisher.ts";
import { WebflowPublisher } from "../lib/domain/cms/webflowPublisher.ts";
import { assertPublicHttpUrlResolved, assertResolvesPublic, isBlockedHostname, isPrivateIp } from "../lib/domain/net/ssrf.ts";
import { disconnectHosted } from "../lib/domain/cms/connectionCleanup.ts";
import type { TicketClaimPort } from "../lib/domain/codefix/ticket.ts";

const baseGuard = (raw: string): URL => {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http/https URLs are allowed");
  return u;
};
const assertUrl = (u: string) => void assertPublicCmsUrl(u, baseGuard);


// ---------- SSRF guard ----------
test("ssrf: names and IPs that must never be fetched", () => {
  for (const h of ["localhost", "localhost.", "LOCALHOST..", "app.localhost", "db.internal", "metadata.google.internal", "metadata.google.internal.", "printer.local", "0.0.0.0"]) {
    assert.equal(isBlockedHostname(h), true, h);
  }
  assert.equal(isBlockedHostname("example.com"), false);
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "::1", "::", "fd00::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "ff02::1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "100.63.0.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("ssrf: DNS answers are checked (any private record rejects) and errors are generic", async () => {
  const lookup = (map: Record<string, string[]>) => async (h: string) => {
    if (!(h in map)) throw new Error("ENOTFOUND secret-internal-detail");
    return map[h].map((address) => ({ address }));
  };
  const l = lookup({ "ok.example": ["93.184.216.34"], "evil.example": ["93.184.216.34", "127.0.0.1"], "meta.example": ["169.254.169.254"], "v6.example": ["fd00::5"], "cg.example": ["100.64.1.1"] });
  await assertResolvesPublic("ok.example", l);
  await assertResolvesPublic("ok.example.", l);
  for (const h of ["evil.example", "meta.example", "v6.example", "cg.example", "nope.example", "localhost.", "x.internal", "127.0.0.1"]) {
    await assert.rejects(assertResolvesPublic(h, l), (e: Error) => e.message === "That address can't be used.", h);
  }
  await assert.rejects(assertPublicHttpUrlResolved("ftp://ok.example/x", l), /http/);
  assert.equal((await assertPublicHttpUrlResolved("https://ok.example/x", l)).hostname, "ok.example");
});

test("cmsFetch: every connection is pinned to a validated address; a private answer blocks it with generic text", async () => {
  const seen: string[] = [];
  const lookup = async (h: string) => {
    seen.push(h);
    return [{ address: h === "rebind.example" ? "10.0.0.9" : PUBLIC_ADDR, family: 4 }];
  };
  const f = fakeFetch(() => ({ body: { ok: 1 } }), lookup);
  await cmsFetch("https://good.example/a", {}, { assertUrl, ...f.net });
  assert.deepEqual(seen, ["good.example"]);
  assert.equal(f.calls[0].address, PUBLIC_ADDR, "the socket is handed the validated address");
  const g = fakeFetch(() => ({ body: {} }), lookup);
  await assert.rejects(cmsFetch("https://rebind.example/a", {}, { assertUrl, ...g.net }), (e: Error) => e instanceof CmsError && e.message === "That address can't be used.");
  assert.equal(g.calls.length, 0);
  for (const u of ["http://localhost./x", "http://a.localhost/x", "http://svc.internal/x", "http://metadata.google.internal/x", "http://[::ffff:127.0.0.1]/x"]) {
    await assert.rejects(cmsFetch(u, {}, { assertUrl, ...g.net }), CmsError, u);
  }
  assert.equal(g.calls.length, 0);
});

test("cmsFetch: a DNS answer that flips to private on a second lookup is never used (rebinding)", async () => {
  let lookups = 0;
  const lookup = async () => {
    lookups += 1;
    return [{ address: lookups === 1 ? PUBLIC_ADDR : "10.0.0.9", family: 4 }];
  };
  const f = fakeFetch(() => ({ body: { ok: 1 } }), lookup);
  const res = await cmsFetch("https://rebind.example/a", {}, { assertUrl, ...f.net });
  assert.equal(res.ok, true);
  assert.equal(lookups, 1, "the name is resolved once per connection");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].address, PUBLIC_ADDR);
});

test("cmsFetch: network errors are not echoed (no port-scan oracle)", async () => {
  const boom = () => {
    throw new Error("connect ECONNREFUSED 10.0.0.5:6379");
  };
  await assert.rejects(cmsFetch("https://good.example/", {}, { assertUrl, transport: boom as never }), (e: Error) => e instanceof CmsError && !/ECONN|10\.0|6379/.test(e.message));
});

test("cmsFetch: redirects must keep the same origin; no downgrade; credentials never leave", async () => {
  const auth = { headers: { Authorization: "Basic abc" } };
  const cases: Array<[string, string, RegExp]> = [
    ["https://example.com/a", "https://example.com:8443/a", /different host/],
    ["https://example.com/a", "http://example.com/a", /https to http/],
    ["https://example.com/a", "https://sub.example.com/a", /different host/],
    ["http://example.com:8080/a", "https://example.com:8080/a", /different host/],
  ];
  for (const [from, to, re] of cases) {
    const f = fakeFetch(() => ({ status: 302, headers: { location: to } }));
    await assert.rejects(cmsFetch(from, auth, { assertUrl, ...f.net }), re, `${from} -> ${to}`);
    assert.equal(f.calls.length, 1, "the credential-bearing request is never repeated elsewhere");
  }
  const same = fakeFetch((c) => (c.url.endsWith("/a") ? { status: 301, headers: { location: "/b" } } : { body: { ok: 1 } }));
  assert.equal((await cmsFetch("https://example.com/a", auth, { assertUrl, ...same.net })).ok, true);
  assert.equal(same.calls[1].headers.Authorization, "Basic abc", "same origin keeps the header");
  const up = fakeFetch((c) => (c.url.startsWith("http:") ? { status: 301, headers: { location: "https://example.com/a" } } : { body: {} }));
  assert.equal((await cmsFetch("http://example.com/a", {}, { assertUrl, ...up.net })).ok, true);
});

// ---------- Webflow locate ----------
const WF_FIELDS = [{ slug: "name", type: "PlainText" }, { slug: "slug", type: "PlainText" }, { slug: "seo-title", type: "PlainText" }];
function wfRoutes(opts: { domains?: unknown[]; shortName?: string; collSlug?: string; seoTitle?: string } = {}) {
  const item = { id: "i1", isDraft: false, lastPublished: "2026-01-01", fieldData: { name: "Post", slug: "post", "seo-title": opts.seoTitle ?? "Old" } };
  return fakeFetch((c) => {
    const u = new URL(c.url);
    if (c.headers.Authorization !== "Bearer tok") return { status: 401 };
    if (u.pathname === "/v2/sites/s1") return { body: { id: "s1", shortName: opts.shortName ?? "mine", customDomains: opts.domains ?? [{ url: "example.com" }] } };
    if (u.pathname === "/v2/collections/c1") return { body: { fields: WF_FIELDS, slug: opts.collSlug ?? "blog", singularName: "Article" } };
    if (u.pathname === "/v2/collections/c1/items" && c.method === "GET") return { body: { items: u.searchParams.get("slug") === "post" ? [item] : [] } };
    if (c.method === "PATCH" || c.method === "POST") return { body: {} };
    return undefined;
  });
}
const wf = (f: ReturnType<typeof fakeFetch>) => new WebflowPublisher({ token: "tok", siteId: "s1", collectionId: "c1" }, { assertUrl, ...f.net });

test("webflow locate: the host must belong to the connected site", async () => {
  const f = wfRoutes();
  await assert.rejects(wf(f).locate("https://other-site.com/blog/post"), /isn't on your connected Webflow site/);
  assert.equal(f.calls.some((c) => c.url.includes("/items")), false, "no item lookup for a foreign host");
  assert.equal((await wf(f).locate("https://example.com/blog/post"))?.id, "i1");
  assert.equal((await wf(f).locate("https://www.example.com/blog/post/"))?.id, "i1");
  const dflt = wfRoutes({ domains: [], shortName: "mine" });
  assert.equal((await wf(dflt).locate("https://mine.webflow.io/blog/post"))?.id, "i1");
  const withScheme = wfRoutes({ domains: [{ url: "https://shop.example.org" }] });
  assert.equal((await wf(withScheme).locate("https://shop.example.org/blog/post"))?.id, "i1");
});

test("webflow locate: the path must match the collection page path, otherwise ask to confirm the page", async () => {
  const f = wfRoutes();
  await assert.rejects(wf(f).locate("https://example.com/post"), /can't confirm/);
  await assert.rejects(wf(f).locate("https://example.com/shop/post"), /can't confirm/);
  await assert.rejects(wf(f).locate("https://example.com/blog/2024/post"), /can't confirm/);
  assert.equal((await wf(f).locate("https://example.com/article/post"))?.id, "i1", "the singular name is accepted too");
  assert.equal(await wf(f).locate("https://example.com/blog/missing"), null);
  assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
});

test("webflow liveBefore reports what the item holds now", async () => {
  const f = wfRoutes({ seoTitle: "Changed since" });
  const it = (await wf(f).locate("https://example.com/blog/post"))!;
  const live = await wf(f).liveBefore(it, [{ field: "title", before: "Old", after: "New" }]);
  assert.deepEqual(live, [{ field: "title", before: "Changed since" }]);
});

// ---------- WordPress partial writes ----------
const WP_REC = {
  id: 7, link: "https://example.com/about/", slug: "about", title: { raw: "About us" },
  content: { raw: '<img src="/a.jpg" class="wp-image-55" alt=""><img src="/b.jpg" class="wp-image-56" alt="">' },
  meta: { _yoast_wpseo_metadesc: "" },
};
function wpRoutes(failMedia: string[] = [], failPost = false) {
  return fakeFetch((c) => {
    const u = new URL(c.url);
    if (c.method === "GET" && u.pathname === "/wp-json/wp/v2/pages/7") return { body: WP_REC };
    if (c.method === "POST" && u.pathname === "/wp-json/wp/v2/pages/7") return failPost ? { status: 500 } : { body: {} };
    if (c.method === "POST" && u.pathname.startsWith("/wp-json/wp/v2/media/")) return failMedia.some((id) => u.pathname.endsWith(`/${id}`)) ? { status: 500 } : { body: {} };
    return undefined;
  });
}
const wp = (f: ReturnType<typeof fakeFetch>) => new WordPressPublisher({ baseUrl: "https://example.com", credentials: "bob:pw" }, { assertUrl, ...f.net });
const wpItem: CmsItemRef = { cms: "wordpress", id: "7", kind: "pages", title: "About", slug: "about", url: "https://example.com/about/" };
const wpChanges: CmsChange[] = [
  { field: "meta_description", before: "", after: "Who we are." },
  { field: "alt_text", target: "55", before: "", after: "Team" },
  { field: "alt_text", target: "56", before: "", after: "Office" },
];

test("wordpress apply: a failed media write after the post is live returns a partial result, not a throw", async () => {
  const f = wpRoutes(["56"]);
  const res = await wp(f).apply(wpItem, wpChanges);
  assert.deepEqual(res.applied, ["meta_description", "alt_text"]);
  assert.deepEqual(res.failed?.map((x) => [x.field, x.target]), [["alt_text", "56"]]);
  assert.equal(f.calls.filter((c) => c.method === "POST").length, 3, "later images are still attempted");
});

test("wordpress apply: a failed post write throws before any media is touched; media-only total failure throws too", async () => {
  const f = wpRoutes([], true);
  await assert.rejects(wp(f).apply(wpItem, wpChanges), CmsError);
  assert.equal(f.calls.filter((c) => c.url.includes("/media/")).length, 0);
  const g = wpRoutes(["55"]);
  await assert.rejects(wp(g).apply(wpItem, [wpChanges[1]]), CmsError);
  const ok = await wp(wpRoutes()).apply(wpItem, wpChanges);
  assert.equal(ok.failed, undefined);
});

test("wordpress liveBefore reflects the live page", async () => {
  const live = await wp(wpRoutes()).liveBefore(wpItem, wpChanges);
  assert.deepEqual(live.map((l) => `${l.field}:${l.target ?? ""}`).sort(), ["alt_text:55", "alt_text:56", "meta_description:"]);
});

// ---------- tickets: revise subset and live-before binding ----------
const secret = "s".repeat(64);
const subject = { userId: "u1", projectId: "p1", findingId: "f1" };
function claims() {
  const used = new Set<string>();
  const port: TicketClaimPort = { async claim(n) { if (used.has(n)) return false; used.add(n); return true; }, async release(n) { used.delete(n); } };
  return port;
}

test("revise: may only keep a subset of the previewed (field, target) slots", async () => {
  const t = issueCmsTicket(secret, subject, { item: wpItem, changes: wpChanges, label: "x" });
  const c = claims();
  const widen = await reviseCmsTicket(secret, t, subject, [...wpChanges, { field: "title", before: "", after: "Sneaky new field" }], c);
  assert.equal(widen.ok === false && widen.status, 400);
  const retarget = await reviseCmsTicket(secret, t, subject, [{ field: "alt_text", target: "99", before: "", after: "Other image" }], c);
  assert.equal(retarget.ok, false);
  // A rejected revise does not spend the ticket.
  const subset = await reviseCmsTicket(secret, t, subject, [{ field: "alt_text", target: "55", before: "", after: "Reworded" }], c);
  assert.equal(subset.ok, true);
  if (subset.ok) {
    // The allowed set is carried over: a revised ticket cannot gain a slot that was never previewed.
    const again = await reviseCmsTicket(secret, subset.ticket, subject, [{ field: "title", before: "", after: "New slot" }], claims());
    assert.equal(again.ok, false);
  }
});

test("apply: the ticket binds the live before values; a changed page no longer matches", async () => {
  const t = issueCmsTicket(secret, subject, { item: wpItem, changes: wpChanges, label: "x" });
  const r = await redeemCmsTicket(secret, t, subject, wpChanges, claims());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const same = wpChanges.map(({ field, target, before }) => ({ field, target, before }));
  assert.equal(liveBeforeMatches(r.befores, r.changes, same), true);
  const edited = same.map((v) => (v.field === "meta_description" ? { ...v, before: "Someone edited this" } : v));
  assert.equal(liveBeforeMatches(r.befores, r.changes, edited), false);
  assert.equal(liveBeforeMatches(r.befores, r.changes, same.slice(1)), false, "a slot that vanished is a change too");
  // After a revise to a subset, the binding still holds for the kept slots.
  const rev = await reviseCmsTicket(secret, t, subject, [wpChanges[0]], claims());
  assert.equal(rev.ok, true);
  if (rev.ok) {
    const r2 = await redeemCmsTicket(secret, rev.ticket, subject, [wpChanges[0]], claims());
    assert.equal(r2.ok && liveBeforeMatches(r2.befores, r2.changes, edited), false);
    assert.equal(r2.ok && liveBeforeMatches(r2.befores, r2.changes, same), true);
  }
});

// ---------- hosted disconnect ----------
test("disconnect: deletes the row and the vault secret it pointed at", async () => {
  const log: string[] = [];
  const res = await disconnectHosted({
    readSecretId: async () => "sec-1",
    deleteRows: async () => (log.push("rows"), true),
    deleteSecret: async (id) => void log.push(`secret:${id}`),
  });
  assert.deepEqual(res, { ok: true, secretDeleted: true });
  assert.deepEqual(log, ["rows", "secret:sec-1"]);
  const none = await disconnectHosted({ readSecretId: async () => null, deleteRows: async () => true, deleteSecret: async () => assert.fail("no secret to delete") });
  assert.equal(none.ok, true);
  const rowFail = await disconnectHosted({ readSecretId: async () => "s", deleteRows: async () => false, deleteSecret: async () => assert.fail("keep the secret while the row remains") });
  assert.equal(rowFail.ok, false);
  const secFail = await disconnectHosted({ readSecretId: async () => "s", deleteRows: async () => true, deleteSecret: async () => { throw new Error("x"); } });
  assert.deepEqual(secFail, { ok: true, secretDeleted: false });
});
