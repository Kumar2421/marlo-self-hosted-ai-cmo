/**
 * Preload for the app process under load test (NODE_OPTIONS=--require .../guard.cjs).
 * Guarantees no packet leaves the machine: every outbound fetch / http(s) request / DNS lookup to a
 * non-loopback host is refused. Known provider hosts are redirected to the canned stubs hosted by the
 * fake Supabase server (/stub/<host>/<path>); anything else gets a 503 and is counted via /__blocked.
 */
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns");

const STUB = process.env.LT_STUB_ORIGIN || "http://127.0.0.1:54391";
const STUB_HOSTS = new Set(["api.tavily.com", "api.groq.com", "api.mistral.ai", "www.googleapis.com", "oauth2.googleapis.com"]);
const origGet = http.get.bind(http);
const origFetch = globalThis.fetch;

const isLoopback = (h) => !h || h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";

function report(host) {
  try {
    origGet(`${STUB}/__blocked?host=${encodeURIComponent(host)}`, (r) => r.resume()).on("error", () => {});
  } catch {
    // reporting is best effort
  }
}

globalThis.fetch = function guardedFetch(input, init) {
  let u;
  try {
    u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  } catch {
    return origFetch(input, init);
  }
  if (isLoopback(u.hostname)) return origFetch(input, init);
  if (STUB_HOSTS.has(u.hostname)) {
    const headers = new Headers(init && init.headers ? init.headers : typeof input === "object" && input.headers ? input.headers : undefined);
    headers.delete("authorization");
    headers.delete("x-goog-api-key");
    const body = init && init.body !== undefined ? init.body : undefined;
    return origFetch(`${STUB}/stub/${u.hostname}${u.pathname}`, { method: (init && init.method) || (typeof input === "object" && input.method) || "GET", headers, body });
  }
  report(u.hostname);
  return Promise.resolve(new Response(JSON.stringify({ error: "blocked by load-test guard", host: u.hostname }), { status: 503, headers: { "content-type": "application/json" } }));
};

for (const mod of [http, https]) {
  const origReq = mod.request;
  const guardReq = function (...args) {
    const a0 = args[0];
    const host = typeof a0 === "string" ? new URL(a0).hostname : a0 instanceof URL ? a0.hostname : (a0 && (a0.hostname || a0.host)) || "";
    if (!isLoopback(String(host).split(":")[0])) {
      report(String(host));
      throw new Error(`load-test guard: outbound request to ${host} refused`);
    }
    return origReq.apply(mod, args);
  };
  mod.request = guardReq;
  mod.get = function (...args) {
    const req = guardReq(...args);
    req.end();
    return req;
  };
}

const origLookup = dns.lookup;
dns.lookup = function (hostname, options, cb) {
  const callback = typeof options === "function" ? options : cb;
  if (typeof hostname === "string" && !isLoopback(hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    report(hostname);
    const err = Object.assign(new Error(`load-test guard: DNS lookup of ${hostname} refused`), { code: "ENOTFOUND", hostname });
    return process.nextTick(callback, err);
  }
  return origLookup.apply(dns, arguments);
};
for (const fn of ["resolve", "resolveMx", "resolve4", "resolve6", "resolveTxt", "resolveCname", "resolveNs", "resolveSrv", "reverse"]) {
  if (typeof dns[fn] !== "function") continue;
  dns[fn] = function (hostname, ...rest) {
    const cb = rest[rest.length - 1];
    report(String(hostname));
    const err = Object.assign(new Error(`load-test guard: DNS ${fn} of ${hostname} refused`), { code: "ENOTFOUND", hostname });
    if (typeof cb === "function") return process.nextTick(cb, err);
    throw err;
  };
  if (dns.promises && typeof dns.promises[fn] === "function") {
    dns.promises[fn] = (hostname) => {
      report(String(hostname));
      return Promise.reject(Object.assign(new Error(`load-test guard: DNS ${fn} of ${hostname} refused`), { code: "ENOTFOUND", hostname }));
    };
  }
}
