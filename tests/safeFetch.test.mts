import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, ClientRequest, RequestOptions } from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import test from "node:test";
import { BLOCKED_MESSAGE } from "../lib/domain/net/ssrf.ts";
import { SAFE_FETCH_NETWORK_MESSAGE, SafeFetchError, safeFetch, type TransportRequest } from "../lib/domain/net/safeFetch.ts";
import { assertSafeUserUrl, INVALID_USER_URL_MESSAGE } from "../lib/domain/net/publicUrl.ts";
import { checkRobotsTxt, fetchSitePage } from "../lib/domain/seo/siteFetch.ts";

// ---- helpers -------------------------------------------------------------------------------

/** Public-looking answers only. No test connects to a real public address. */
const PUBLIC_A = "93.184.216.34";
const PUBLIC_B = "93.184.216.35";

type Table = Record<string, string[]>;

/** Injected resolver. Records every name it is asked for; unknown names fail like NXDOMAIN. */
function mockDns(table: Table, asked: string[] = []) {
  const lookup = (host: string) => {
    asked.push(host);
    const addrs = table[host];
    if (!addrs) return Promise.reject(new Error("ENOTFOUND"));
    return Promise.resolve(addrs.map((address) => ({ address, family: net.isIP(address) })));
  };
  return { lookup, asked };
}

type Seen = { host: string; protocol: string; path: string; address?: string; headers: OutgoingHttpHeaders };

/** Stands in for one ClientRequest. `end()` runs the async body once, like a socket would. */
class StubRequest extends EventEmitter {
  destroyed = false;
  onDestroy: (() => void) | undefined = undefined;
  run: () => Promise<void>;
  constructor(run: () => Promise<void>) {
    super();
    this.run = run;
  }
  end(): void {
    this.run().catch((err: unknown) => {
      if (!this.destroyed) this.emit("error", err);
    });
  }
  destroy(): this {
    this.destroyed = true;
    this.onDestroy?.();
    return this;
  }
}

/** The address the socket would connect to: the pinned lookup, called the way Node calls it. */
function pinnedAddress(options: RequestOptions, host: string): Promise<string> {
  if (net.isIP(host)) return Promise.resolve(host);
  const lookup = options.lookup as unknown as (h: string, o: object, cb: (err: Error | null, address?: string) => void) => void;
  return new Promise((resolve, reject) => {
    lookup(host, { all: false }, (err, address) => (err ? reject(err) : resolve(String(address))));
  });
}

type Route = { status: number; headers?: Record<string, string>; body?: string };
type Routes = (host: string, path: string, protocol: string) => Route | null;

function fakeResponse(route: Route): IncomingMessage {
  const res = Readable.from(route.body ? [Buffer.from(route.body)] : []) as unknown as IncomingMessage;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(route.headers ?? {})) headers[k.toLowerCase()] = v;
  Object.assign(res, { statusCode: route.status, headers });
  return res;
}

/** Route table transport. Every connection goes through the pinned lookup first, then gets a canned answer. */
function routeTransport(routes: Routes, seen: Seen[]): TransportRequest {
  return (options, onResponse) => {
    const host = String(options.hostname);
    const req = new StubRequest(async () => {
      const address = await pinnedAddress(options, host);
      seen.push({ host, protocol: String(options.protocol), path: String(options.path), address, headers: (options.headers ?? {}) as OutgoingHttpHeaders });
      if (req.destroyed) return;
      const route = routes(host, String(options.path).split("?")[0], String(options.protocol));
      if (!route) throw new Error("no route");
      onResponse(fakeResponse(route));
    });
    return req as unknown as ClientRequest;
  };
}

/** Real loopback server as the "socket". The validated address is still checked; the bytes go to 127.0.0.1 only. */
function loopbackTransport(port: number, seen: Seen[]): TransportRequest {
  return (options, onResponse) => {
    const host = String(options.hostname);
    let real: ClientRequest | undefined;
    const req = new StubRequest(async () => {
      const address = await pinnedAddress(options, host);
      seen.push({ host, protocol: String(options.protocol), path: String(options.path), address, headers: (options.headers ?? {}) as OutgoingHttpHeaders });
      if (req.destroyed) return;
      real = http.request({ hostname: "127.0.0.1", port, path: options.path, method: options.method, headers: options.headers as OutgoingHttpHeaders }, onResponse);
      real.on("error", (err) => req.emit("error", err));
      real.end();
    });
    req.onDestroy = () => real?.destroy();
    return req as unknown as ClientRequest;
  };
}

/** Transport that must never be reached: proves a check ran before any connection. */
const noConnect: TransportRequest = () => {
  throw new Error("transport must not be reached");
};

async function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  server.on("clientError", (_err, socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

async function expectBlocked(p: Promise<unknown>): Promise<SafeFetchError> {
  const err = await p.then(
    () => assert.fail("expected rejection"),
    (e: unknown) => e
  );
  assert.ok(err instanceof SafeFetchError, `expected SafeFetchError, got ${String(err)}`);
  assert.equal(err.message, BLOCKED_MESSAGE);
  assert.ok(err.code.startsWith("policy:"), err.code);
  return err;
}

const PUBLIC_TABLE: Table = { "public.test": [PUBLIC_A], "other.test": [PUBLIC_B], "site.test": [PUBLIC_A], "evil.test": [PUBLIC_B] };

// ---- literal and DNS policy ----------------------------------------------------------------

test("private, loopback, link-local, CGNAT, ULA and mapped IPv6 literals are rejected before any connection", async () => {
  const targets = [
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://172.16.9.9/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/",
  ];
  for (const url of targets) {
    await expectBlocked(safeFetch(url, { transport: noConnect }));
  }
});

test("trailing-dot and numeric-form loopback names are rejected", async () => {
  await expectBlocked(safeFetch("http://localhost./", { transport: noConnect }));
  await expectBlocked(safeFetch("http://0x7f.1/", { transport: noConnect }));
});

test("a name whose answers mix public and private addresses is rejected and never connects", async () => {
  const seen: Seen[] = [];
  const { lookup } = mockDns({ "mixed.test": [PUBLIC_A, "10.0.0.7"] });
  await expectBlocked(safeFetch("http://mixed.test/", { lookup, transport: routeTransport(() => ({ status: 200 }), seen) }));
  assert.equal(seen.length, 0);
});

test("a name that resolves only to private addresses is rejected", async () => {
  const seen: Seen[] = [];
  const { lookup } = mockDns({ "priv.test": ["127.0.0.1"] });
  await expectBlocked(safeFetch("http://priv.test/", { lookup, transport: routeTransport(() => ({ status: 200 }), seen) }));
  assert.equal(seen.length, 0);
});

test("a failed lookup is reported with the generic network message", async () => {
  const { lookup } = mockDns({});
  const err = await safeFetch("http://nowhere.test/", { lookup, transport: routeTransport(() => ({ status: 200 }), []) }).then(
    () => assert.fail("expected rejection"),
    (e: unknown) => e
  );
  assert.ok(err instanceof SafeFetchError);
  assert.equal(err.message, SAFE_FETCH_NETWORK_MESSAGE);
});

test("credentials in the URL are rejected", async () => {
  await expectBlocked(safeFetch("http://user:pass@public.test/", { transport: noConnect }));
  await expectBlocked(safeFetch("https://user@public.test/", { transport: noConnect }));
});

test("ports outside the allowlist are rejected", async () => {
  const { lookup } = mockDns(PUBLIC_TABLE);
  await expectBlocked(safeFetch("http://public.test:22/", { lookup, transport: noConnect }));
  await expectBlocked(safeFetch("http://public.test:6379/", { lookup, transport: noConnect }));
});

// ---- pinned connection (DNS rebinding) -----------------------------------------------------

test("DNS rebinding: the connection uses the validated address and a flipped second answer is never consulted", async () => {
  let calls = 0;
  const lookup = async () => {
    calls += 1;
    return calls === 1 ? [{ address: PUBLIC_A, family: 4 }] : [{ address: "10.0.0.9", family: 4 }];
  };
  const seen: Seen[] = [];
  const res = await safeFetch("http://rebind.test/", {
    lookup,
    transport: routeTransport(() => ({ status: 200, body: "ok" }), seen),
  });
  assert.equal(res.bodyText, "ok");
  assert.equal(calls, 1, "the name is resolved exactly once per connection");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].address, PUBLIC_A, "the socket is handed the validated public address");
});

// ---- redirects -----------------------------------------------------------------------------

test("a redirect to a private IP literal is rejected and that address is never requested", async () => {
  const seen: Seen[] = [];
  const routes: Routes = (host) => (host === "public.test" ? { status: 302, headers: { location: "http://127.0.0.1/secret" } } : { status: 200, body: "secret" });
  const { lookup } = mockDns(PUBLIC_TABLE);
  await expectBlocked(safeFetch("http://public.test/", { lookup, transport: routeTransport(routes, seen) }));
  assert.ok(!seen.some((s) => s.host === "127.0.0.1"));
});

test("a redirect to a hostname that resolves private is rejected", async () => {
  const seen: Seen[] = [];
  const routes: Routes = (host) => (host === "public.test" ? { status: 302, headers: { location: "http://internal.test/admin" } } : { status: 200 });
  const { lookup } = mockDns({ ...PUBLIC_TABLE, "internal.test": ["10.1.1.1"] });
  await expectBlocked(safeFetch("http://public.test/", { lookup, transport: routeTransport(routes, seen) }));
  assert.ok(!seen.some((s) => s.host === "internal.test"));
});

test("a redirect chain longer than 5 hops is rejected", async () => {
  const hopRoute: Routes = (host, path) => {
    const n = Number(path.replace("/h", ""));
    return { status: 302, headers: { location: `http://public.test/h${n + 1}` } };
  };
  const { lookup } = mockDns(PUBLIC_TABLE);
  const err = await safeFetch("http://public.test/h0", { lookup, transport: routeTransport(hopRoute, []) }).then(
    () => assert.fail("expected rejection"),
    (e: unknown) => e
  );
  assert.ok(err instanceof SafeFetchError);
  assert.equal(err.code, "redirect:limit");
});

test("a redirect chain of exactly 5 hops is followed to the end", async () => {
  const routes: Routes = (_host, path) => {
    const n = Number(path.replace("/h", ""));
    return n >= 5 ? { status: 200, body: "done" } : { status: 302, headers: { location: `http://public.test/h${n + 1}` } };
  };
  const { lookup } = mockDns(PUBLIC_TABLE);
  const res = await safeFetch("http://public.test/h0", { lookup, transport: routeTransport(routes, []) });
  assert.equal(res.bodyText, "done");
  assert.equal(res.redirectCount, 5);
});

test("the SEO page crawl reports a redirect loop as the last 3xx instead of throwing", async () => {
  const routes: Routes = () => ({ status: 302, headers: { location: "/again" } });
  const { lookup } = mockDns(PUBLIC_TABLE);
  const page = await fetchSitePage(new URL("http://public.test/"), 5000, { lookup, transport: routeTransport(routes, []) });
  assert.equal(page.status, 302);
  assert.equal(page.redirectCount, 5);
});

test("an https to http downgrade on redirect is rejected", async () => {
  const routes: Routes = () => ({ status: 302, headers: { location: "http://public.test/plain" } });
  const { lookup } = mockDns(PUBLIC_TABLE);
  const err = await expectBlocked(safeFetch("https://public.test/", { lookup, transport: routeTransport(routes, []) }));
  assert.equal(err.code, "policy:downgrade");
});

test("a cookie or authorization header from the caller never reaches the network, and encoding is pinned to identity", async () => {
  const seen: Seen[] = [];
  const { lookup } = mockDns(PUBLIC_TABLE);
  await safeFetch("http://public.test/", {
    lookup,
    headers: { Cookie: "session=1", Authorization: "Basic abc", "User-Agent": "ua/1" },
    transport: routeTransport(() => ({ status: 200 }), seen),
  });
  const headers = seen[0].headers as Record<string, string>;
  assert.equal(headers.cookie, undefined);
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["accept-encoding"], "identity");
  assert.equal(headers["User-Agent"], "ua/1");
});

test("sameHostOnly refuses a redirect to another host", async () => {
  const routes: Routes = (host) => (host === "site.test" ? { status: 302, headers: { location: "http://evil.test/robots.txt" } } : { status: 200, body: "User-agent: *\nDisallow: /" });
  const seen: Seen[] = [];
  const { lookup } = mockDns(PUBLIC_TABLE);
  const err = await safeFetch("http://site.test/robots.txt", { lookup, sameHostOnly: true, transport: routeTransport(routes, seen) }).then(
    () => assert.fail("expected rejection"),
    (e: unknown) => e
  );
  assert.ok(err instanceof SafeFetchError);
  assert.equal(err.code, "policy:cross-host");
  assert.ok(!seen.some((s) => s.host === "evil.test"));
});

test("robots.txt: an off-host redirect is not followed and the file counts as absent", async () => {
  const routes: Routes = (host) => (host === "site.test" ? { status: 302, headers: { location: "http://evil.test/robots.txt" } } : { status: 200, body: "User-agent: *\nDisallow: /" });
  const seen: Seen[] = [];
  const { lookup } = mockDns(PUBLIC_TABLE);
  const out = await checkRobotsTxt("http://site.test", "/", { lookup, transport: routeTransport(routes, seen) });
  assert.deepEqual(out, { exists: false, disallowsThisPage: false });
  assert.ok(!seen.some((s) => s.host === "evil.test"), "the off-host robots file is never requested");
});

test("robots.txt: a same-host file is parsed for the wildcard group", async () => {
  const routes: Routes = () => ({ status: 200, body: "User-agent: googlebot\nDisallow: /all\n\nUser-agent: *\nDisallow: /private" });
  const { lookup } = mockDns(PUBLIC_TABLE);
  const out = await checkRobotsTxt("http://site.test", "/private/page", { lookup, transport: routeTransport(routes, []) });
  assert.deepEqual(out, { exists: true, disallowsThisPage: true });
});

// ---- content type --------------------------------------------------------------------------

test("a 2xx response with a disallowed content type is refused", async () => {
  const { lookup } = mockDns(PUBLIC_TABLE);
  const err = await safeFetch("http://public.test/", {
    lookup,
    allowedContentTypes: ["text/html"],
    transport: routeTransport(() => ({ status: 200, headers: { "content-type": "image/png" }, body: "x" }), []),
  }).then(
    () => assert.fail("expected rejection"),
    (e: unknown) => e
  );
  assert.ok(err instanceof SafeFetchError);
  assert.equal(err.code, "content-type");
});

// ---- real loopback fixtures: body cap, deadline, happy path --------------------------------

test("a body larger than the cap is cut off and flagged as truncated", async () => {
  const { server, port } = await listen((_req, res) => {
    res.on("error", () => undefined);
    res.writeHead(200, { "content-type": "text/plain" });
    const chunk = Buffer.alloc(64 * 1024, 97);
    let sent = 0;
    const pump = () => {
      while (!res.destroyed && sent < 3 * 1024 * 1024) {
        sent += chunk.length;
        if (!res.write(chunk)) {
          res.once("drain", pump);
          return;
        }
      }
      if (!res.destroyed) res.end();
    };
    pump();
  });
  try {
    const seen: Seen[] = [];
    const { lookup } = mockDns(PUBLIC_TABLE);
    const res = await safeFetch("http://public.test/big", { lookup, maxBytes: 1024 * 1024, transport: loopbackTransport(port, seen) });
    assert.equal(res.status, 200);
    assert.equal(res.truncated, true);
    assert.equal(res.body.length, 1024 * 1024);
    assert.equal(seen[0].address, PUBLIC_A);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("a trickling response is aborted at the total deadline with the generic message", async () => {
  const { server, port } = await listen((_req, res) => {
    res.on("error", () => undefined);
    res.writeHead(200, { "content-type": "text/plain" });
    const timer = setInterval(() => {
      if (res.destroyed) return clearInterval(timer);
      res.write("a");
    }, 200);
    res.on("close", () => clearInterval(timer));
  });
  try {
    const { lookup } = mockDns(PUBLIC_TABLE);
    const started = Date.now();
    const err = await safeFetch("http://public.test/slow", { lookup, timeoutMs: 700, transport: loopbackTransport(port, []) }).then(
      () => assert.fail("expected a timeout"),
      (e: unknown) => e
    );
    assert.ok(err instanceof SafeFetchError);
    assert.equal(err.code, "network:timeout");
    assert.equal(err.message, SAFE_FETCH_NETWORK_MESSAGE);
    assert.ok(Date.now() - started < 3000, "the deadline is total, not idle");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("loopback fixture happy path returns the body through the pinned path", async () => {
  const { server, port } = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<title>hello</title>");
  });
  try {
    const seen: Seen[] = [];
    const { lookup } = mockDns(PUBLIC_TABLE);
    const res = await safeFetch("http://public.test/", { lookup, transport: loopbackTransport(port, seen), allowedContentTypes: ["text/html"] });
    assert.equal(res.bodyText, "<title>hello</title>");
    assert.equal(res.truncated, false);
    assert.equal(seen[0].address, PUBLIC_A);
  } finally {
    server.close();
  }
});

// ---- user-entered URL validation -----------------------------------------------------------

test("competitor and audit input: loopback, localhost and IPv6 loopback are rejected with the generic message", async () => {
  const { lookup } = mockDns(PUBLIC_TABLE);
  for (const raw of ["http://127.0.0.1", "https://localhost/", "http://[::1]/", "http://10.0.0.1/"]) {
    await assert.rejects(assertSafeUserUrl(raw, lookup), (e: unknown) => e instanceof Error && e.message === BLOCKED_MESSAGE, raw);
  }
});

test("user input: DNS answers are checked, a mixed answer is rejected, a public one is accepted", async () => {
  const { lookup } = mockDns({ "public.test": [PUBLIC_A], "mixed.test": [PUBLIC_A, "192.168.0.4"], "rebound.test": ["127.0.0.1"] });
  const ok = await assertSafeUserUrl("https://public.test/path?q=1", lookup);
  assert.equal(ok.hostname, "public.test");
  await assert.rejects(assertSafeUserUrl("https://mixed.test/", lookup), (e: unknown) => e instanceof Error && e.message === BLOCKED_MESSAGE);
  await assert.rejects(assertSafeUserUrl("https://rebound.test/", lookup), (e: unknown) => e instanceof Error && e.message === BLOCKED_MESSAGE);
});

test("user input: credentials, odd ports, non-http schemes and overlong URLs are rejected", async () => {
  const { lookup } = mockDns(PUBLIC_TABLE);
  await assert.rejects(assertSafeUserUrl("https://user:pw@public.test/", lookup), (e: unknown) => e instanceof Error && /username and password/.test(e.message));
  await assert.rejects(assertSafeUserUrl("http://public.test:8080/", lookup), (e: unknown) => e instanceof Error && e.message === BLOCKED_MESSAGE);
  await assert.rejects(assertSafeUserUrl("ftp://public.test/", lookup), (e: unknown) => e instanceof Error && e.message === INVALID_USER_URL_MESSAGE);
  await assert.rejects(assertSafeUserUrl(`https://public.test/${"a".repeat(2100)}`, lookup), (e: unknown) => e instanceof Error && e.message === INVALID_USER_URL_MESSAGE);
});

// ---- error text ----------------------------------------------------------------------------

test("public error text never contains the host, the IP or an errno", async () => {
  const { lookup } = mockDns({ "priv.test": ["10.9.8.7"] });
  const cases: Promise<unknown>[] = [
    safeFetch("http://priv.test/", { lookup, transport: noConnect }),
    safeFetch("http://nowhere-host.test/", { lookup, transport: noConnect }),
    safeFetch("http://127.0.0.1:9/", { transport: noConnect }),
    safeFetch("http://public.test/", { lookup, transport: () => { throw new Error("connect ECONNREFUSED 93.184.216.34:443"); } }),
  ];
  for (const p of cases) {
    const err = await p.then(
      () => assert.fail("expected rejection"),
      (e: unknown) => e
    );
    assert.ok(err instanceof SafeFetchError);
    const text = String((err as Error).message);
    assert.ok(text === BLOCKED_MESSAGE || text === SAFE_FETCH_NETWORK_MESSAGE, text);
    for (const leak of ["priv.test", "nowhere-host", "10.9.8.7", "127.0.0.1", "93.184", "ECONN", "ENOTFOUND", "connect"]) {
      assert.ok(!text.includes(leak), `leaked ${leak}`);
    }
  }
});
