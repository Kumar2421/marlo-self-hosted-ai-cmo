import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import net from "node:net";
import { Readable } from "node:stream";
import test from "node:test";
import { capCrawlDelay, getCrawlDelay, isAllowed, parseRobots, ROBOTS_MAX_BYTES } from "../lib/domain/net/robotsPolicy.ts";
import type { TransportRequest } from "../lib/domain/net/safeFetch.ts";
import { checkRobotsTxt, robotsDecision } from "../lib/domain/seo/siteFetch.ts";

const UA = "OkaraAlternative/1.0";
const allowed = (txt: string, path: string, ua = UA) => isAllowed(parseRobots(txt), ua, path);

// ---- parser and matcher (pure) ---------------------------------------------------------------

test("two User-agent lines share the rules that follow them", () => {
  const txt = "User-agent: BotA\nUser-agent: BotB\nDisallow: /x\n\nUser-agent: *\nDisallow: /y";
  assert.equal(parseRobots(txt).groups.length, 2);
  assert.equal(allowed(txt, "/x", "BotA"), false);
  assert.equal(allowed(txt, "/x", "BotB"), false);
  assert.equal(allowed(txt, "/y", "BotB"), true, "a named group replaces the * group");
  assert.equal(allowed(txt, "/y", "Other"), false);
});

test("a User-agent line after a rule starts a new group", () => {
  const txt = "User-agent: A\nDisallow: /a\nUser-agent: B\nDisallow: /b";
  assert.equal(allowed(txt, "/b", "A"), true);
  assert.equal(allowed(txt, "/b", "B"), false);
});

test("user-agent matching is case-insensitive and uses the product token", () => {
  const txt = "USER-AGENT: okaraALTERNATIVE\nDISALLOW: /secret";
  assert.equal(allowed(txt, "/secret"), false);
  assert.equal(allowed(txt, "/open"), true);
});

test("the * group applies when no group names the crawler", () => {
  const txt = "User-agent: Googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /all";
  assert.equal(allowed(txt, "/all"), false);
  assert.equal(allowed(txt, "/g"), true);
  assert.equal(allowed("User-agent: Googlebot\nDisallow: /", "/anything"), true, "no group and no * means allowed");
});

test("the longest matching rule wins, whatever the order", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /a\nAllow: /a/b", "/a/b/c"), true);
  assert.equal(allowed("User-agent: *\nAllow: /a/b\nDisallow: /a", "/a/b/c"), true);
  assert.equal(allowed("User-agent: *\nDisallow: /a/b\nAllow: /a", "/a/b/c"), false);
  assert.equal(allowed("User-agent: *\nDisallow: /a\nAllow: /a/b", "/a/z"), false);
});

test("Allow wins a tie", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /page\nAllow: /page", "/page"), true);
  assert.equal(allowed("User-agent: *\nAllow: /page\nDisallow: /page", "/page"), true);
});

test("wildcards and the $ end anchor", () => {
  const txt = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/cache\nAllow: /tmp-ok/cache";
  assert.equal(allowed(txt, "/docs/a.pdf"), false);
  assert.equal(allowed(txt, "/docs/a.pdf?x=1"), true, "$ anchors at the end of path plus query");
  assert.equal(allowed(txt, "/docs/a.pdfx"), true);
  assert.equal(allowed(txt, "/tmp123/cache"), false);
  assert.equal(allowed(txt, "/tmp-ok/cache"), true);
});

test("the query string takes part in matching", () => {
  const txt = "User-agent: *\nDisallow: /*?session=";
  assert.equal(allowed(txt, "/page?session=1"), false);
  assert.equal(allowed(txt, "/page?other=1"), true);
  assert.equal(allowed("User-agent: *\nDisallow: /search?q=", "/search?q=cats"), false);
});

test("percent-encoded paths and rules compare equal", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /caf%C3%A9", "/café"), false);
  assert.equal(allowed("User-agent: *\nDisallow: /café", "/caf%c3%a9/menu"), false);
  assert.equal(allowed("User-agent: *\nDisallow: /a-b", "/a%2Db"), false, "an escaped unreserved character is the same character");
  assert.equal(allowed("User-agent: *\nDisallow: /a%2Fb", "/a/b"), true, "an escaped slash is not a slash");
  assert.equal(allowed("User-agent: *\nDisallow: /a%2Fb", "/a%2fb"), false);
});

test("comments, blank lines, CRLF and a BOM are tolerated", () => {
  const txt = "﻿# top comment\r\n\r\nUser-agent: * # everyone\r\n\r\n  Disallow : /hidden # why\r\nnot a directive\r\n";
  assert.equal(allowed(txt, "/hidden"), false);
  assert.equal(allowed(txt, "/shown"), true);
});

test("an empty Disallow allows everything", () => {
  assert.equal(allowed("User-agent: *\nDisallow:", "/anything"), true);
  assert.equal(allowed("User-agent: *\nDisallow:\nDisallow: /x", "/x"), false, "other rules in the group still count");
});

test("an empty or missing path is the root", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /", ""), false);
  assert.equal(allowed("User-agent: *\nDisallow: /a", "a"), false);
});

test("crawl-delay: own group first, then *", () => {
  const txt = "User-agent: *\nCrawl-delay: 10\n\nUser-agent: okaraalternative\nCrawl-delay: 2.5";
  assert.equal(getCrawlDelay(parseRobots(txt), UA), 2.5);
  assert.equal(getCrawlDelay(parseRobots(txt), "Other"), 10);
  assert.equal(getCrawlDelay(parseRobots("User-agent: *\nDisallow: /x"), UA), null);
  assert.equal(getCrawlDelay(parseRobots("User-agent: *\nCrawl-delay: soon"), UA), null, "junk is ignored");
  assert.equal(getCrawlDelay(parseRobots("Crawl-delay: 5\nUser-agent: *\nDisallow: /x"), UA), null, "a delay before any group belongs to nobody");
});

test("capCrawlDelay returns null when over the cap", () => {
  assert.equal(capCrawlDelay(null), null);
  assert.equal(capCrawlDelay(5), 5);
  assert.equal(capCrawlDelay(60), 60);
  assert.equal(capCrawlDelay(61), null);
  assert.equal(capCrawlDelay(20, 10), null);
  assert.equal(capCrawlDelay(10, 10), 10);
});

// ---- robotsDecision with a fake transport ----------------------------------------------------

type Route = { status: number; headers?: Record<string, string>; body?: string };
type Routes = (host: string, path: string) => Route | "error";

class StubRequest extends EventEmitter {
  destroyed = false;
  run: () => void;
  constructor(run: () => void) {
    super();
    this.run = run;
  }
  end(): void {
    this.run();
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

function transport(routes: Routes, seen: string[] = []): TransportRequest {
  return (options, onResponse) => {
    const host = String(options.hostname);
    const req = new StubRequest(() => {
      seen.push(`${host}${options.path}`);
      const route = routes(host, String(options.path));
      if (route === "error") return void req.emit("error", Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
      const res = Readable.from(route.body ? [Buffer.from(route.body)] : []) as unknown as IncomingMessage;
      Object.assign(res, { statusCode: route.status, headers: route.headers ?? {} });
      onResponse(res);
    });
    return req as unknown as ClientRequest;
  };
}

const lookup = async (host: string) => [{ address: host === "evil.test" ? "93.184.216.35" : "93.184.216.34", family: net.isIP("93.184.216.34") }];
const decide = (routes: Routes, path = "/", seen: string[] = []) =>
  robotsDecision("http://site.test", path, { lookup, transport: transport(routes, seen) });

test("robotsDecision: 2xx is parsed and reports the crawl delay", async () => {
  const body = "User-agent: *\nDisallow: /private\nCrawl-delay: 7";
  assert.deepEqual(await decide(() => ({ status: 200, body }), "/public"), { status: "allowed", crawlDelaySec: 7 });
  assert.deepEqual(await decide(() => ({ status: 200, body }), "/private/x"), { status: "blocked", crawlDelaySec: 7 });
  assert.deepEqual(await decide(() => ({ status: 200, body: "" })), { status: "allowed" });
});

test("robotsDecision: 404 and 403 mean no file; 429, 500 and 503 mean unreachable", async () => {
  assert.deepEqual(await decide(() => ({ status: 404 })), { status: "missing" });
  assert.deepEqual(await decide(() => ({ status: 410 })), { status: "missing" });
  assert.deepEqual(await decide(() => ({ status: 403 })), { status: "missing" });
  assert.deepEqual(await decide(() => ({ status: 429 })), { status: "unreachable" });
  assert.deepEqual(await decide(() => ({ status: 500 })), { status: "unreachable" });
  assert.deepEqual(await decide(() => ({ status: 503 })), { status: "unreachable" });
});

test("robotsDecision: a network error or timeout is unreachable", async () => {
  assert.deepEqual(await decide(() => "error"), { status: "unreachable" });
});

test("robotsDecision: a same-host redirect is followed, an off-host one is refused", async () => {
  const same: Routes = (_h, path) =>
    path === "/robots.txt" ? { status: 301, headers: { location: "http://site.test/real-robots" } } : { status: 200, body: "User-agent: *\nDisallow: /" };
  assert.deepEqual(await decide(same), { status: "blocked" });

  const seen: string[] = [];
  const off: Routes = (host) => (host === "site.test" ? { status: 302, headers: { location: "http://evil.test/robots.txt" } } : { status: 200, body: "User-agent: *\nDisallow: /" });
  assert.deepEqual(await decide(off, "/", seen), { status: "unreachable" });
  assert.ok(!seen.some((s) => s.startsWith("evil.test")), "the off-host file is never requested");
});

test("robotsDecision: only the first 500 KiB is considered and a cut line is dropped", async () => {
  const head = "User-agent: *\nDisallow: /early\n";
  const filler = `# ${"x".repeat(100)}\n`;
  const padded = head + filler.repeat(Math.ceil((ROBOTS_MAX_BYTES - head.length) / filler.length));
  const body = padded + "Disallow: /late\n";
  assert.ok(body.length > ROBOTS_MAX_BYTES);
  assert.equal((await decide(() => ({ status: 200, body }), "/early")).status, "blocked");
  assert.equal((await decide(() => ({ status: 200, body }), "/late")).status, "allowed", "a rule past the cap is ignored");

  // The cap lands inside "Disallow: /private" after "Disallow: /": keeping that cut line would block the whole site.
  const fill = "#".repeat(ROBOTS_MAX_BYTES - "User-agent: *\n".length - "Disallow: /".length - 1) + "\n";
  const cut = `User-agent: *\n${fill}Disallow: /private\n`;
  assert.ok(cut.length > ROBOTS_MAX_BYTES && cut.indexOf("Disallow: /private") < ROBOTS_MAX_BYTES);
  assert.equal((await decide(() => ({ status: 200, body: cut }), "/open")).status, "allowed", "a half-read rule does not block the site");
});

test("checkRobotsTxt keeps its shape: unreadable counts as no robots.txt", async () => {
  const run = (routes: Routes, path = "/") => checkRobotsTxt("http://site.test", path, { lookup, transport: transport(routes) });
  assert.deepEqual(await run(() => ({ status: 200, body: "User-agent: *\nDisallow: /private" }), "/private/page"), { exists: true, disallowsThisPage: true });
  assert.deepEqual(await run(() => ({ status: 200, body: "User-agent: *\nDisallow: /private" }), "/ok"), { exists: true, disallowsThisPage: false });
  assert.deepEqual(await run(() => ({ status: 404 })), { exists: false, disallowsThisPage: false });
  assert.deepEqual(await run(() => ({ status: 503 })), { exists: false, disallowsThisPage: false });
  assert.deepEqual(await run(() => "error"), { exists: false, disallowsThisPage: false });
});
