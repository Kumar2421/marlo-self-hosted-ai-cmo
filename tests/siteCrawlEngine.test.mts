import test from "node:test";
import assert from "node:assert/strict";
import {
  crawlDedupeKey, crawlSitePages, normalizeCrawlUrl, type CrawlOptions, type FetchPageOutcome,
} from "../lib/domain/seo/SiteCrawlAgent.ts";
import { JINA_MAX_BYTES, jinaRead } from "../lib/domain/shared/jinaReader.ts";
import { fakeFetch, publicLookup } from "./support/cmsTransport.mts";

const LONG = "word ".repeat(80);
const okPage = (title = "T"): FetchPageOutcome => ({ kind: "ok", title, content: LONG });
const links = (...hrefs: string[]) => hrefs.map((href) => ({ href }));
const html = (text: string) => `<html><head><title>T</title></head><body>${text}</body></html>`;
const HTML_TYPE = { "content-type": "text/html; charset=utf-8" };

/** A clock the ports advance by hand, so the budget never depends on real time. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const noJina: CrawlOptions["jina"] = async () => {
  throw new Error("jina must not be called");
};

test("normalizeCrawlUrl strips fragment, tracking params, trailing slash, default port and host case", () => {
  assert.equal(normalizeCrawlUrl("https://Example.COM/Pricing/#plans"), "https://example.com/Pricing");
  assert.equal(normalizeCrawlUrl("https://example.com/a?utm_source=x&utm_medium=y&gclid=1&fbclid=2&ref=keep"), "https://example.com/a?ref=keep");
  assert.equal(normalizeCrawlUrl("https://example.com:443/a/"), "https://example.com/a");
  assert.equal(normalizeCrawlUrl("http://example.com:80/"), "http://example.com");
  assert.equal(normalizeCrawlUrl("https://example.com:8443/a"), "https://example.com:8443/a");
  assert.equal(normalizeCrawlUrl("https://example.com/a?b=2&a=1"), "https://example.com/a?a=1&b=2");
});

test("normalizeCrawlUrl rejects non-http(s) input and www is only merged by the dedupe key", () => {
  assert.equal(normalizeCrawlUrl("ftp://example.com/a"), null);
  assert.equal(normalizeCrawlUrl("javascript:alert(1)"), null);
  assert.equal(normalizeCrawlUrl("not a url"), null);
  assert.equal(normalizeCrawlUrl("https://www.example.com/a"), "https://www.example.com/a");
  assert.equal(crawlDedupeKey("https://www.example.com/a/"), crawlDedupeKey("https://example.com/a#x"));
  assert.notEqual(crawlDedupeKey("https://example.com/a"), crawlDedupeKey("https://example.com/b"));
});

test("12 distinct hrefs lead to at most 8 fetches and the summary says capped", async () => {
  const fetched: string[] = [];
  const hrefs = Array.from({ length: 12 }, (_, i) => `https://site.test/p${i}`);
  const { pages, summary } = await crawlSitePages(links(...hrefs), {
    fetchPage: async (url) => { fetched.push(url); return okPage(); },
    jina: noJina,
  });
  assert.equal(fetched.length, 8);
  assert.equal(pages.length, 8);
  assert.equal(summary.requested, 8);
  assert.equal(summary.crawled, 8);
  assert.equal(summary.capped, true);
  assert.equal(summary.partial, false);
  assert.equal(summary.reasons, undefined);
});

test("exactly MAX_PAGES distinct candidates is not capped", async () => {
  const hrefs = Array.from({ length: 8 }, (_, i) => `https://site.test/p${i}`);
  const { summary } = await crawlSitePages(links(...hrefs), { fetchPage: async () => okPage(), jina: noJina });
  assert.equal(summary.capped, false);
});

test("duplicates, fragments, tracking params, trailing slashes and www variants collapse before counting", async () => {
  const fetched: string[] = [];
  const { summary } = await crawlSitePages(
    links(
      "https://site.test/a",
      "https://site.test/a/",
      "https://site.test/a#top",
      "https://site.test/a?utm_source=news&utm_campaign=x",
      "https://SITE.test:443/a?fbclid=abc",
      "https://www.site.test/a",
      "https://site.test/b",
    ),
    { fetchPage: async (url) => { fetched.push(url); return okPage(); }, jina: noJina },
  );
  assert.deepEqual(fetched, ["https://site.test/a", "https://site.test/b"]);
  assert.equal(summary.requested, 2);
  assert.equal(summary.capped, false);
});

test("duplicates do not use up MAX_PAGES slots", async () => {
  const fetched: string[] = [];
  const dupes = Array.from({ length: 10 }, () => "https://site.test/same#frag");
  await crawlSitePages(links(...dupes, "https://site.test/x", "https://site.test/y"), {
    fetchPage: async (url) => { fetched.push(url); return okPage(); },
    jina: noJina,
  });
  assert.deepEqual(fetched, ["https://site.test/same", "https://site.test/x", "https://site.test/y"]);
});

test("login pages and non-http links are not candidates", async () => {
  const fetched: string[] = [];
  const { summary } = await crawlSitePages(links("https://site.test/login", "mailto:a@b.c", "https://site.test/ok"), {
    fetchPage: async (url) => { fetched.push(url); return okPage(); },
    jina: noJina,
  });
  assert.deepEqual(fetched, ["https://site.test/ok"]);
  assert.equal(summary.requested, 1);
});

test("a host that resolves to a private address never gets a connection and is recorded as failed", async () => {
  const net = fakeFetch(() => ({ status: 200, body: html(LONG), headers: HTML_TYPE }), publicLookup({ "internal.test": ["10.0.0.5"] }));
  const { pages, summary } = await crawlSitePages(links("https://internal.test/a", "https://127.0.0.1/b", "https://site.test/c"), {
    ...net.net,
    jina: noJina,
  });
  assert.deepEqual(net.calls.map((c) => c.url), ["https://site.test/c"]);
  assert.deepEqual(pages.map((p) => p.url), ["https://site.test/c"]);
  assert.equal(summary.skipped.failed, 2);
  assert.deepEqual(summary.reasons?.map((r) => [r.url, r.status]), [["https://internal.test/a", "failed"], ["https://127.0.0.1/b", "failed"]]);
});

test("a fetch that never settles returns within the budget with partial set", async () => {
  const started = Date.now();
  const { pages, summary } = await crawlSitePages(links("https://site.test/a", "https://site.test/b"), {
    fetchPage: () => new Promise<never>(() => {}),
    jina: noJina,
    budgetMs: 80,
    minPageBudgetMs: 1,
  });
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(pages, []);
  assert.equal(summary.partial, true);
  assert.equal(summary.skipped.budget, 2);
  assert.deepEqual(summary.reasons?.map((r) => r.status), ["budget", "budget"]);
});

test("a slow page within its own limit is a timeout, not a budget stop", async () => {
  const { summary } = await crawlSitePages(links("https://site.test/a"), {
    fetchPage: () => new Promise<never>(() => {}),
    jina: noJina,
    perPageTimeoutMs: 30,
    budgetMs: 10_000,
    minPageBudgetMs: 1,
  });
  assert.equal(summary.partial, false);
  assert.equal(summary.skipped.failed, 1);
  assert.equal(summary.reasons?.[0].status, "timeout");
});

test("when too little budget is left for Jina it is not called and the page is a budget skip", async () => {
  const clock = fakeClock();
  const { pages, summary } = await crawlSitePages(links("https://site.test/thin"), {
    now: clock.now,
    budgetMs: 10_000,
    fetchPage: async () => { clock.advance(7_000); return { kind: "ok", title: "", content: "short" }; },
    jina: noJina,
  });
  assert.deepEqual(pages, []);
  assert.equal(summary.partial, true);
  assert.equal(summary.skipped.budget, 1);
  assert.equal(summary.reasons?.[0].status, "budget");
});

test("a thin page falls back to Jina with min(35 s, remaining) and a failed first render is retried", async () => {
  const clock = fakeClock();
  const limits: number[] = [];
  const { pages, summary } = await crawlSitePages(links("https://site.test/spa"), {
    now: clock.now,
    budgetMs: 20_000,
    fetchPage: async () => ({ kind: "ok", title: "", content: "" }),
    jina: async (_url, { timeoutMs }) => {
      limits.push(timeoutMs);
      clock.advance(2_000);
      return limits.length === 1 ? null : { title: "SPA", content: "rendered" };
    },
  });
  assert.deepEqual(limits, [20_000, 18_000]);
  assert.equal(pages[0].source, "jina-fallback");
  assert.equal(pages[0].title, "SPA");
  assert.equal(summary.partial, false);

  const big = await crawlSitePages(links("https://site.test/spa"), {
    now: clock.now,
    fetchPage: async () => ({ kind: "ok", title: "", content: "" }),
    jina: async (_url, { timeoutMs }) => { limits.push(timeoutMs); return { title: "", content: "x" }; },
  });
  assert.equal(limits[2], 35_000);
  assert.equal(big.pages.length, 1);
});

test("a Jina call still running at the deadline is abandoned and counted against the budget", async () => {
  const started = Date.now();
  const { summary } = await crawlSitePages(links("https://site.test/spa"), {
    budgetMs: 60,
    minPageBudgetMs: 1,
    minJinaBudgetMs: 1,
    fetchPage: async () => ({ kind: "ok", title: "", content: "" }),
    jina: () => new Promise<never>(() => {}),
  });
  assert.ok(Date.now() - started < 2000);
  assert.equal(summary.partial, true);
  assert.equal(summary.skipped.budget, 1);
});

test("a non-HTML response is skipped as non-html with a reason, not an error", async () => {
  const net = fakeFetch((c) =>
    c.url.endsWith("/file.pdf")
      ? { status: 200, body: "%PDF", headers: { "content-type": "application/pdf" } }
      : { status: 200, body: html(LONG), headers: HTML_TYPE },
  );
  const { pages, summary } = await crawlSitePages(links("https://site.test/file.pdf", "https://site.test/ok"), { ...net.net, jina: noJina });
  assert.deepEqual(pages.map((p) => p.url), ["https://site.test/ok"]);
  assert.equal(summary.skipped.nonHtml, 1);
  assert.equal(summary.skipped.failed, 0);
  assert.deepEqual(summary.reasons, [{ url: "https://site.test/file.pdf", status: "non-html" }]);
});

test("a failed page is recorded with a reason and the other pages are still returned", async () => {
  const net = fakeFetch((c) =>
    c.url.endsWith("/gone") ? { status: 404, body: "nope", headers: HTML_TYPE } : { status: 200, body: html(LONG), headers: HTML_TYPE },
  );
  const { pages, summary } = await crawlSitePages(links("https://site.test/a", "https://site.test/gone", "https://site.test/b"), { ...net.net, jina: noJina });
  assert.deepEqual(pages.map((p) => p.url), ["https://site.test/a", "https://site.test/b"]);
  assert.equal(summary.skipped.failed, 1);
  assert.deepEqual(summary.reasons, [{ url: "https://site.test/gone", status: "failed", detail: "HTTP 404" }]);
  assert.equal(summary.partial, false);
});

test("a port that throws is a failed page, never a rejection", async () => {
  const { pages, summary } = await crawlSitePages(links("https://site.test/a", "https://site.test/b"), {
    fetchPage: async (url) => {
      if (url.endsWith("/a")) throw new Error("boom");
      return okPage();
    },
    jina: noJina,
  });
  assert.deepEqual(pages.map((p) => p.url), ["https://site.test/b"]);
  assert.equal(summary.reasons?.[0].status, "failed");
});

test("an injected clock makes the budget deterministic: pages stop when the clock says time is up", async () => {
  const clock = fakeClock();
  const fetched: string[] = [];
  const hrefs = Array.from({ length: 8 }, (_, i) => `https://site.test/p${i}`);
  const { pages, summary } = await crawlSitePages(links(...hrefs), {
    now: clock.now,
    budgetMs: 40_000,
    fetchPage: async (url) => { fetched.push(url); clock.advance(15_000); return okPage(); },
    jina: noJina,
  });
  // 40 s -> 25 s -> 10 s left (third still starts) -> -5 s: the other five never start.
  assert.equal(fetched.length, 3);
  assert.equal(pages.length, 3);
  assert.equal(summary.partial, true);
  assert.equal(summary.skipped.budget, 5);
  assert.equal(summary.reasons?.length, 5);
});

test("no page call starts below the minimum remaining budget", async () => {
  const clock = fakeClock();
  const fetched: string[] = [];
  const { summary } = await crawlSitePages(links("https://site.test/a", "https://site.test/b"), {
    now: clock.now,
    budgetMs: 10_000,
    fetchPage: async (url) => { fetched.push(url); clock.advance(9_500); return okPage(); },
    jina: noJina,
  });
  assert.deepEqual(fetched, ["https://site.test/a"]);
  assert.equal(summary.skipped.budget, 1);
});

test("the optional robots port can block a page and defaults to allowing everything", async () => {
  const fetched: string[] = [];
  const opts = { fetchPage: async (url: string) => { fetched.push(url); return okPage(); }, jina: noJina };
  const blocked = await crawlSitePages(links("https://site.test/private", "https://site.test/open"), {
    ...opts,
    robots: async (url) => (url.endsWith("/private") ? "blocked" : "allowed"),
  });
  assert.deepEqual(fetched, ["https://site.test/open"]);
  assert.equal(blocked.summary.skipped.blocked, 1);
  assert.equal(blocked.summary.reasons?.[0].status, "blocked");
  fetched.length = 0;
  await crawlSitePages(links("https://site.test/private"), opts);
  assert.deepEqual(fetched, ["https://site.test/private"]);
});

test("near-duplicate pages are still marked after the crawl", async () => {
  const { pages } = await crawlSitePages(links("https://site.test/a", "https://site.test/b"), { fetchPage: async () => okPage(), jina: noJina });
  assert.equal(pages[1].duplicateOfUrl, "https://site.test/a");
});

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("jinaRead returns a normal response and drops one over the body cap", async () => {
  const lookup = publicLookup();
  const body = JSON.stringify({ data: { title: "T", content: "hello", url: "https://site.test/" } });
  const ok = await withFetch(async () => new Response(body), () => jinaRead("https://site.test/", lookup));
  assert.equal(ok?.content, "hello");

  const huge = JSON.stringify({ data: { title: "T", content: "x".repeat(JINA_MAX_BYTES + 10) } });
  assert.equal(await withFetch(async () => new Response(huge), () => jinaRead("https://site.test/", lookup)), null);

  // No content-length: the streamed read itself stops at the cap.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const chunk = new Uint8Array(100_000).fill(120);
      for (let i = 0; i < 8; i++) controller.enqueue(chunk);
      controller.close();
    },
  });
  assert.equal(await withFetch(async () => new Response(stream), () => jinaRead("https://site.test/", lookup)), null);
});

test("jinaRead honours a shorter timeout than its default", async () => {
  const started = Date.now();
  const hang: typeof fetch = (_input, init) =>
    new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  assert.equal(await withFetch(hang, () => jinaRead("https://site.test/", publicLookup(), { timeoutMs: 40 })), null);
  assert.ok(Date.now() - started < 2000);
});
