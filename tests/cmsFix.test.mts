import test from "node:test";
import assert from "node:assert/strict";
import {
  CmsError, EMPTY_DRAFT, classifyForCms, cmsCanApply, parseClientCmsChanges, sanitizeDraft, anyCmsCanFix,
  type CmsChange, type CmsFixKind, type CmsItemRef, type CmsPublisher,
} from "../lib/domain/cms/cmsFixCatalog.ts";
import { hashCmsChanges, issueCmsTicket, redeemCmsTicket, reviseCmsTicket } from "../lib/domain/cms/cmsTicket.ts";
import { buildCmsCopyPrompt, parseModelJson, prepareCmsFix } from "../lib/domain/cms/cmsFixService.ts";
import { assertPublicCmsUrl, cmsFetch } from "../lib/domain/cms/cmsFetch.ts";
import { fakeFetch } from "./support/cmsTransport.mts";
import { WordPressPublisher } from "../lib/domain/cms/wordpressPublisher.ts";
import { WebflowPublisher, listWebflowSites } from "../lib/domain/cms/webflowPublisher.ts";
import type { TicketClaimPort } from "../lib/domain/codefix/ticket.ts";

// The repo guard, restated here so the test needs no app aliases.
function guard(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http/https URLs are allowed");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local") || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
    throw new Error("URLs pointing to local/private addresses are not allowed");
  }
  return u;
}
const assertUrl = (u: string) => void assertPublicCmsUrl(u, guard);


const finding = (entityId: string, source = "seo-audit") => ({ source, entityId, entityType: "page", evidence: {} });

// ---------- catalog ----------
test("catalog: WordPress and Webflow support exactly the agreed kinds", () => {
  for (const k of ["title", "meta_description", "open_graph", "twitter_card", "alt_text", "h1", "canonical"] as CmsFixKind[]) assert.equal(cmsCanApply("wordpress", k), true, k);
  for (const k of ["title", "meta_description", "open_graph", "alt_text"] as CmsFixKind[]) assert.equal(cmsCanApply("webflow", k), true, k);
  for (const k of ["twitter_card", "canonical", "h1", "json_ld", "faq_schema", "llms_txt", "sitemap"] as CmsFixKind[]) assert.equal(cmsCanApply("webflow", k), false, k);
  for (const k of ["json_ld", "faq_schema", "llms_txt", "sitemap"] as CmsFixKind[]) assert.equal(cmsCanApply("wordpress", k), false, k);
});

test("catalog: classification follows the finding, and structural findings are never fixable", () => {
  assert.deepEqual(classifyForCms("webflow", finding("meta-description-missing")), { fixable: true, kinds: ["meta_description"], label: "Meta description" });
  assert.equal(classifyForCms("wordpress", finding("canonical-missing")).fixable, true);
  assert.equal(classifyForCms("webflow", finding("canonical-missing")).fixable, false);
  assert.equal(classifyForCms("webflow", finding("twitter-tags-missing")).fixable, false);
  assert.equal(classifyForCms("wordpress", finding("lighthouse-largest-contentful-paint")).fixable, false);
  assert.equal(classifyForCms("wordpress", finding("heading-order")).fixable, false);
  assert.equal(classifyForCms("wordpress", finding("anything-else")).fixable, false);
  assert.equal(anyCmsCanFix(["webflow", "wordpress"], finding("canonical-missing")), "wordpress");
  assert.equal(anyCmsCanFix([], finding("canonical-missing")), null);
});

test("validation: rejects markup, empty, oversize, foreign canonical, duplicates and fields a CMS cannot take", () => {
  const ctx = { cms: "wordpress" as const, pageUrl: "https://example.com/a" };
  const ok = parseClientCmsChanges([{ field: "title", before: "x", after: "  Hello <b>world</b> " }], ctx);
  assert.equal(ok[0].after, "Hello bworld/b");
  assert.ok(!ok[0].after.includes("<"));
  assert.throws(() => parseClientCmsChanges([], ctx), CmsError);
  assert.throws(() => parseClientCmsChanges([{ field: "title", after: "" }], ctx), /empty/);
  assert.throws(() => parseClientCmsChanges([{ field: "title", after: "x".repeat(200) }], ctx), /too long/);
  assert.throws(() => parseClientCmsChanges([{ field: "canonical", after: "https://evil.com/a" }], ctx), /your own site/);
  assert.throws(() => parseClientCmsChanges([{ field: "canonical", after: "javascript:alert(1)" }], ctx), /full URL/);
  assert.equal(parseClientCmsChanges([{ field: "canonical", after: "https://www.example.com/a" }], ctx).length, 1);
  assert.throws(() => parseClientCmsChanges([{ field: "title", after: "a" }, { field: "title", after: "b" }], ctx), /twice/);
  assert.throws(() => parseClientCmsChanges([{ field: "alt_text", after: "a" }], ctx), /image/);
  assert.throws(() => parseClientCmsChanges([{ field: "twitter_title", after: "a" }], { ...ctx, cms: "webflow" }), /can't change/);
  assert.throws(() => parseClientCmsChanges([{ field: "nope", after: "a" }], ctx), /unknown/);
});

test("sanitizeDraft keeps only allowed, clean, in-limit values", () => {
  const d = sanitizeDraft({ fields: { title: "<i>Hi</i>", meta_description: "z".repeat(999), og_title: "Not asked" }, alt: { "12": "A cat", "99": "Not a target" } }, ["title", "meta_description", "alt_text"], ["12"]);
  assert.deepEqual(d, { fields: { title: "iHi/i" }, alt: { "12": "A cat" } });
  assert.deepEqual(sanitizeDraft(null, ["title"], []), { fields: {}, alt: {} });
  assert.equal(parseModelJson('Sure! {"fields":{"title":"x"}} done') !== null, true);
  assert.equal(parseModelJson("no json"), null);
});

// ---------- tickets ----------
const secret = "s".repeat(64);
const subject = { userId: "u1", projectId: "p1", findingId: "f1" };
const item: CmsItemRef = { cms: "wordpress", id: "7", kind: "pages", title: "About", slug: "about", url: "https://example.com/about" };
const changes: CmsChange[] = [{ field: "meta_description", before: "", after: "A good description." }];

function claims() {
  const used = new Set<string>();
  const port: TicketClaimPort = { async claim(n) { if (used.has(n)) return false; used.add(n); return true; }, async release(n) { used.delete(n); } };
  return port;
}

test("ticket: applies exactly what was previewed, once", async () => {
  const c = claims();
  const t = issueCmsTicket(secret, subject, { item, changes, label: "Meta description" });
  const r = await redeemCmsTicket(secret, t, subject, changes, c);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.item, item);
  const replay = await redeemCmsTicket(secret, t, subject, changes, c);
  assert.equal(replay.ok === false && replay.status, 409);
});

test("ticket: release lets a failed write retry the same preview", async () => {
  const c = claims();
  const t = issueCmsTicket(secret, subject, { item, changes, label: "x" });
  const first = await redeemCmsTicket(secret, t, subject, changes, c);
  assert.equal(first.ok, true);
  if (first.ok) await first.release();
  assert.equal((await redeemCmsTicket(secret, t, subject, changes, c)).ok, true);
});

test("ticket: tampered token, wrong user/project/finding, edited changes, expiry and wrong secret all fail", async () => {
  const t = issueCmsTicket(secret, subject, { item, changes, label: "x" }, 1000);
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), item: { ...item, id: "8" } })).toString("base64url");
  const cases: Array<[string, unknown, typeof subject, unknown, string, number?]> = [
    ["forged item", `${forged}.${sig}`, subject, changes, secret, 2000],
    ["garbage", "abc", subject, changes, secret, 2000],
    ["other user", t, { ...subject, userId: "u2" }, changes, secret, 2000],
    ["other project", t, { ...subject, projectId: "p2" }, changes, secret, 2000],
    ["other finding", t, { ...subject, findingId: "f2" }, changes, secret, 2000],
    ["wrong secret", t, subject, changes, "z".repeat(64), 2000],
    ["expired", t, subject, changes, secret, 1000 + 31 * 60 * 1000],
  ];
  for (const [name, token, subj, ch, sec, now] of cases) {
    const r = await redeemCmsTicket(sec, token, subj, ch, claims(), now);
    assert.equal(r.ok, false, name);
  }
  const edited = await redeemCmsTicket(secret, t, subject, [{ ...changes[0], after: "Something else entirely." }], claims(), 2000);
  assert.equal(edited.ok === false && edited.status, 409);
  assert.notEqual(hashCmsChanges(changes), hashCmsChanges([{ ...changes[0], after: "other" }]));
  assert.equal(hashCmsChanges([changes[0]]), hashCmsChanges([{ ...changes[0], before: "ignored" }]));
});

test("ticket: revise re-signs an edit once, and the old ticket is spent", async () => {
  const c = claims();
  const t = issueCmsTicket(secret, subject, { item, changes, label: "x" });
  const edit: CmsChange[] = [{ field: "meta_description", before: "", after: "My own wording." }];
  const revised = await reviseCmsTicket(secret, t, subject, edit, c);
  assert.equal(revised.ok, true);
  assert.equal((await redeemCmsTicket(secret, t, subject, changes, c)).ok, false);
  if (revised.ok) {
    assert.equal((await redeemCmsTicket(secret, revised.ticket, subject, changes, claims())).ok, false, "old content no longer matches");
    assert.equal((await redeemCmsTicket(secret, revised.ticket, subject, edit, claims())).ok, true);
  }
  const bad = await reviseCmsTicket(secret, issueCmsTicket(secret, subject, { item, changes, label: "x" }), subject, [{ field: "canonical", after: "https://evil.com" }], claims());
  assert.equal(bad.ok, false);
});

// ---------- SSRF / fetch ----------
test("ssrf: private, loopback, link-local and non-http addresses are rejected before any request", async () => {
  for (const u of ["http://localhost/x", "http://127.0.0.1/x", "http://10.0.0.5/x", "http://192.168.1.1/x", "http://169.254.169.254/latest", "http://[::1]/x", "http://[fd00::1]/x", "ftp://example.com/x", "http://100.64.0.1/x"]) {
    const f = fakeFetch(() => ({ body: {} }));
    await assert.rejects(cmsFetch(u, {}, { assertUrl, ...f.net }), CmsError, u);
    assert.equal(f.calls.length, 0, u);
  }
});

test("ssrf: redirects are capped, re-checked and never leave the host", async () => {
  const loop = fakeFetch((c) => ({ status: 302, headers: { location: c.url + "x" } }));
  await assert.rejects(cmsFetch("https://example.com/a", {}, { assertUrl, ...loop.net }), /too many/);
  assert.equal(loop.calls.length, 4);
  const toPrivate = fakeFetch(() => ({ status: 302, headers: { location: "http://169.254.169.254/" } }));
  await assert.rejects(cmsFetch("https://example.com/a", {}, { assertUrl, ...toPrivate.net }), /different host/);
  const toOther = fakeFetch(() => ({ status: 302, headers: { location: "https://attacker.example/" } }));
  await assert.rejects(cmsFetch("https://example.com/a", { headers: { Authorization: "Basic abc" } }, { assertUrl, ...toOther.net }), /different host/);
  assert.equal(toOther.calls.length, 1, "credentials never sent to the other host");
  const sameHost = fakeFetch((c) => (c.url.startsWith("http:") ? { status: 301, headers: { location: "https://example.com/a" } } : { body: { ok: 1 } }));
  const ok = await cmsFetch("http://example.com/a", {}, { assertUrl, ...sameHost.net });
  assert.equal(ok.ok, true);
  const write = fakeFetch(() => ({ status: 302, headers: { location: "https://example.com/b" } }));
  await assert.rejects(cmsFetch("https://example.com/a", { method: "POST", body: "{}" }, { assertUrl, ...write.net }), /redirected a write/);
});

// ---------- WordPress ----------
const WP_RECORD = {
  id: 7, link: "https://example.com/about/", slug: "about", title: { raw: "About us" },
  content: { raw: '<p>Hi</p><img src="https://example.com/wp-content/uploads/team.jpg" class="wp-image-55" alt=""><img src="/b.png" class="wp-image-56" alt="Has alt">' },
  meta: { _yoast_wpseo_metadesc: "", _yoast_wpseo_title: "Old SEO title" },
};

function wpRoutes(rec: unknown = WP_RECORD) {
  return fakeFetch((c) => {
    const u = new URL(c.url);
    if (!c.headers.Authorization?.startsWith("Basic ")) return { status: 401 };
    if (c.method === "GET" && u.pathname === "/wp-json/wp/v2/pages" && u.searchParams.get("slug") === "about") return { body: [rec] };
    if (c.method === "GET" && u.pathname === "/wp-json/wp/v2/posts") return { body: [] };
    if (c.method === "GET" && u.pathname === "/wp-json/wp/v2/pages/7") return { body: rec };
    if (c.method === "POST") return { body: { id: 7 } };
    return undefined;
  });
}
const wp = (f: ReturnType<typeof fakeFetch>) => new WordPressPublisher({ baseUrl: "https://example.com", credentials: "bob:app pass" }, { assertUrl, ...f.net });

test("wordpress: locate by slug, preview before/after, supported SEO fields via Yoast meta, alt text via media id", async () => {
  const f = wpRoutes();
  const p = wp(f);
  const located = await p.locate("https://www.example.com/about/");
  assert.equal(located?.id, "7");
  assert.equal(located?.kind, "pages");
  const kinds: CmsFixKind[] = ["title", "meta_description", "alt_text"];
  const empty = await p.preview(located!, { kinds, draft: EMPTY_DRAFT });
  assert.equal(empty.changes.length, 0);
  assert.deepEqual(empty.candidates.map((c) => c.field + (c.target ? ":" + c.target : "")), ["title", "meta_description", "alt_text:55"]);
  assert.equal(empty.candidates[0].before, "Old SEO title");
  const full = await p.preview(located!, { kinds, draft: { fields: { title: "About Acme", meta_description: "Who we are." }, alt: { "55": "The team" } } });
  assert.equal(full.changes.length, 3);
  assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0, "preview never writes");
});

test("wordpress: apply writes meta + media, only after reading, and reports unsupported fields honestly", async () => {
  const f = wpRoutes();
  const p = wp(f);
  const it = (await p.locate("https://example.com/about"))!;
  const res = await p.apply(it, [
    { field: "meta_description", before: "", after: "Who we are." },
    { field: "alt_text", target: "55", before: "", after: "The team" },
  ]);
  assert.deepEqual(res.applied, ["meta_description", "alt_text"]);
  const posts = f.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 2);
  assert.deepEqual(JSON.parse(posts[0].body!), { meta: { "_yoast_wpseo_metadesc": "Who we are." } });
  assert.deepEqual(JSON.parse(posts[1].body!), { alt_text: "The team" });
  assert.ok(posts[1].url.endsWith("/media/55"));

  const noPlugin = wpRoutes({ ...WP_RECORD, meta: [] });
  const p2 = wp(noPlugin);
  const it2 = (await p2.locate("https://example.com/about"))!;
  const prev = await p2.preview(it2, { kinds: ["meta_description", "open_graph", "canonical", "title"], draft: { fields: { title: "New title" }, alt: {} } });
  assert.deepEqual(prev.unsupported.map((u) => u.field).sort(), ["canonical", "meta_description", "og_description", "og_title"]);
  assert.match(prev.unsupported[0].reason, /Yoast|Rank Math/);
  assert.equal(prev.changes[0].field, "title", "title falls back to the post title");
  await assert.rejects(p2.apply(it2, [{ field: "meta_description", before: "", after: "x" }]), /no longer take/);
  assert.equal(noPlugin.calls.filter((c) => c.method === "POST").length, 0, "nothing written when a field is unsupported");
});

test("wordpress: forged targets, other hosts and bad credentials are refused; the password is never in URLs or errors", async () => {
  const f = wpRoutes();
  const p = wp(f);
  const it = (await p.locate("https://example.com/about"))!;
  await assert.rejects(p.apply(it, [{ field: "alt_text", target: "999", before: "", after: "x" }]), /no longer take/);
  await assert.rejects(p.locate("https://other.com/about"), /isn't on your connected/);
  assert.equal(await p.locate("https://example.com/"), null);
  await assert.rejects(p.apply({ ...it, id: "7; DROP" }, [{ field: "title", before: "", after: "x" }]), /isn't valid/);
  const bad = new WordPressPublisher({ baseUrl: "https://example.com", credentials: "bob:secretpw" }, { assertUrl, ...fakeFetch(() => ({ status: 401 })).net });
  await assert.rejects(bad.locate("https://example.com/about"), (e: Error) => /rejected the saved credentials/.test(e.message) && !e.message.includes("secretpw"));
  assert.ok(f.calls.every((c) => !c.url.includes("app%20pass") && !c.url.includes("app pass")));
  const priv = new WordPressPublisher({ baseUrl: "http://10.0.0.1", credentials: "a:b" }, { assertUrl, ...f.net });
  await assert.rejects(priv.locate("http://10.0.0.1/about"), CmsError);
});

// ---------- Webflow ----------
const WF_FIELDS = [
  { slug: "name", type: "PlainText" }, { slug: "slug", type: "PlainText" },
  { slug: "seo-title", type: "PlainText", displayName: "SEO title" },
  { slug: "meta-description", type: "PlainText", displayName: "Meta description" },
  { slug: "hero", type: "Image", displayName: "Hero" },
];
function wfItem(over: Record<string, unknown> = {}) {
  return { id: "i1", isDraft: false, isArchived: false, lastPublished: "2026-01-01", fieldData: { name: "Post", slug: "post", "seo-title": "Old", "meta-description": "", hero: { fileId: "f", url: "https://cdn/x/hero.png", alt: "" } }, ...over };
}
function wfRoutes(item = wfItem(), fields = WF_FIELDS) {
  return fakeFetch((c) => {
    const u = new URL(c.url);
    if (u.hostname !== "api.webflow.com") return { status: 500 };
    if (c.headers.Authorization !== "Bearer tok") return { status: 401 };
    if (c.method === "GET" && u.pathname === "/v2/sites") return { body: { sites: [{ id: "s1", displayName: "My site" }] } };
    if (c.method === "GET" && u.pathname === "/v2/sites/s1") return { body: { id: "s1", shortName: "my-site", customDomains: [{ id: "d1", url: "example.com" }] } };
    if (c.method === "GET" && u.pathname === "/v2/collections/c1") return { body: { fields, slug: "blog", singularName: "Post" } };
    if (c.method === "GET" && u.pathname === "/v2/collections/c1/items") return { body: { items: u.searchParams.get("slug") === "post" ? [item] : [] } };
    if (c.method === "PATCH" && u.pathname === "/v2/collections/c1/items/i1") return { body: item };
    if (c.method === "POST" && u.pathname === "/v2/collections/c1/items/publish") return { status: 202, body: { publishedItemIds: ["i1"] } };
    return undefined;
  });
}
const wf = (f: ReturnType<typeof fakeFetch>) => new WebflowPublisher({ token: "tok", siteId: "s1", collectionId: "c1" }, { assertUrl, ...f.net });

test("webflow: validate token via sites, locate by slug, preview, apply patches fieldData then republishes a live item", async () => {
  const f = wfRoutes();
  assert.deepEqual(await listWebflowSites("tok", { assertUrl, ...f.net }), [{ id: "s1", name: "My site" }]);
  await assert.rejects(listWebflowSites("nope", { assertUrl, ...f.net }), /rejected/);
  const p = wf(f);
  const it = (await p.locate("https://www.example.com/blog/post"))!;
  assert.equal(it.collectionId, "c1");
  assert.equal(await p.locate("https://example.com/blog/missing"), null);
  const prev = await p.preview(it, { kinds: ["title", "meta_description", "alt_text", "open_graph"], draft: { fields: { title: "New", meta_description: "Desc." }, alt: { hero: "A hero" } } });
  assert.deepEqual(prev.changes.map((c) => c.field), ["title", "meta_description", "alt_text"]);
  assert.deepEqual(prev.unsupported.map((u) => u.field).sort(), ["og_description", "og_title"]);
  assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
  const res = await p.apply(it, prev.changes);
  assert.equal(res.note, undefined);
  const writes = f.calls.filter((c) => c.method !== "GET");
  assert.deepEqual(writes.map((c) => c.method), ["PATCH", "POST"]);
  assert.deepEqual(JSON.parse(writes[0].body!).fieldData, { "seo-title": "New", "meta-description": "Desc.", hero: { fileId: "f", url: "https://cdn/x/hero.png", alt: "A hero" } });
  assert.deepEqual(JSON.parse(writes[1].body!), { itemIds: ["i1"] });
});

test("webflow: draft items stay drafts, wrong collection or missing field is refused", async () => {
  const f = wfRoutes(wfItem({ isDraft: true, lastPublished: null }));
  const p = wf(f);
  const it = (await p.locate("https://example.com/blog/post"))!;
  const res = await p.apply(it, [{ field: "title", before: "", after: "New" }]);
  assert.match(res.note ?? "", /draft/);
  assert.equal(f.calls.filter((c) => c.method === "POST").length, 0);
  await assert.rejects(p.apply({ ...it, collectionId: "other" }, [{ field: "title", before: "", after: "x" }]), /isn't in the connected/);
  const bare = wf(wfRoutes(wfItem(), [{ slug: "name", type: "PlainText" }]));
  await assert.rejects(bare.apply(it, [{ field: "title", before: "", after: "x" }]), /no longer take/);
});

// ---------- service ----------
test("service: prepare locates, drafts from current values, previews; refuses when nothing is possible", async () => {
  const f = wpRoutes();
  const seen: string[] = [];
  const out = await prepareCmsFix({
    publisher: wp(f), pageUrl: "https://example.com/about", kinds: ["meta_description"],
    draftCopy: async (cands) => { seen.push(...cands.map((c) => c.field)); return { fields: { meta_description: "About Acme in a sentence." } }; },
  });
  assert.deepEqual(seen, ["meta_description"]);
  assert.equal(out.changes[0].after, "About Acme in a sentence.");
  await assert.rejects(prepareCmsFix({ publisher: wp(f), pageUrl: null, kinds: ["title"], draftCopy: async () => ({}) }), /isn't tied to a page/);
  await assert.rejects(prepareCmsFix({ publisher: wp(f), pageUrl: "https://example.com/about", kinds: ["title"], draftCopy: async () => ({ fields: {} }) }), /usable change/);
  await assert.rejects(prepareCmsFix({ publisher: wp(wpRoutes({ ...WP_RECORD, meta: [] })), pageUrl: "https://example.com/about", kinds: ["canonical"], draftCopy: async () => ({}) }), /Yoast/);
  const { prompt } = buildCmsCopyPrompt({ projectName: "Acme", pageUrl: "https://example.com/about", recommendation: "Add one", evidence: {}, candidates: out.candidates });
  assert.match(prompt, /meta_description \(max 320/);
});

// A tiny publisher fake proves the port is all the service needs.
test("port: a bare fake publisher satisfies the service", async () => {
  const fake: CmsPublisher = {
    cms: "wordpress",
    locate: async () => item,
    preview: async (it, { draft }) => ({ item: it, candidates: [{ field: "title", before: "a" }], changes: draft.fields.title ? [{ field: "title", before: "a", after: draft.fields.title }] : [], unsupported: [] }),
    liveBefore: async () => [{ field: "title", before: "a" }],
    apply: async () => ({ applied: ["title"], liveUrl: item.url }),
  };
  const out = await prepareCmsFix({ publisher: fake, pageUrl: item.url, kinds: ["title"], draftCopy: async () => ({ fields: { title: "Better" } }) });
  assert.equal(out.changes[0].after, "Better");
});
