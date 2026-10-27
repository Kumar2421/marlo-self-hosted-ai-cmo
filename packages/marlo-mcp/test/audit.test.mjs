import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BASE_URL, formatAudit, parseTargetUrl, resolveConfig, runAudit } from "../src/audit.mjs";

const SAMPLE = {
  url: "https://example.com/",
  findings: [
    { issueId: "title-missing", category: "On-page", severity: "Error", label: "Missing page title", evidence: { titleLength: 0, status: 200 }, autoFixable: true, whyItMatters: "Search engines use the title.", recommendation: "Add a <title> of 30 to 60 characters." },
    { issueId: "meta-long", category: "On-page", severity: "Warning", label: "Meta description too long", evidence: { length: 188 }, autoFixable: false, whyItMatters: "It gets cut off in results.", recommendation: "Shorten it to under 160 characters." },
  ],
  summary: { totalFindings: 5, critical: 1, warnings: 4 },
  technical: { onPageScore: 71, status: 200, redirectCount: 0 },
};

const fakeResponse = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

test("parseTargetUrl accepts bare domains and http(s) only", () => {
  assert.equal(parseTargetUrl("example.com"), "https://example.com/");
  assert.equal(parseTargetUrl("  https://example.com/a?b=1 "), "https://example.com/a?b=1");
  assert.equal(parseTargetUrl("http://example.com"), "http://example.com/");
  for (const bad of ["", "   ", "ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "http://", "a".repeat(2100)]) {
    assert.throws(() => parseTargetUrl(bad), Error, bad.slice(0, 30));
  }
  assert.throws(() => parseTargetUrl(undefined));
  assert.throws(() => parseTargetUrl(42));
});

test("resolveConfig uses the hosted app by default and never sends the password to it", () => {
  assert.deepEqual(resolveConfig({ MARLO_ACCESS_PASSWORD: "secret" }), { baseUrl: DEFAULT_BASE_URL, password: "" });
  assert.deepEqual(resolveConfig({ MARLO_BASE_URL: "http://localhost:3000/", MARLO_ACCESS_PASSWORD: "secret" }), { baseUrl: "http://localhost:3000", password: "secret" });
  assert.throws(() => resolveConfig({ MARLO_BASE_URL: "not a url" }));
  assert.throws(() => resolveConfig({ MARLO_BASE_URL: "ftp://x.test" }));
});

test("runAudit posts only the URL and returns the parsed answer", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return fakeResponse(200, SAMPLE); };
  const out = await runAudit("https://example.com/", { baseUrl: "https://app.test", password: "" }, fetchImpl);
  assert.equal(seen.url, "https://app.test/api/public/audit");
  assert.equal(seen.init.method, "POST");
  assert.deepEqual(JSON.parse(seen.init.body), { url: "https://example.com/" });
  assert.equal(seen.init.headers.Authorization, undefined);
  assert.equal(out.summary.totalFindings, 5);
});

test("runAudit sends Basic auth only when a password is configured", async () => {
  let headers;
  await runAudit("https://example.com/", { baseUrl: "http://localhost:3000", password: "pw" }, async (_u, init) => { headers = init.headers; return fakeResponse(200, SAMPLE); });
  assert.equal(headers.Authorization, `Basic ${Buffer.from("marlo:pw").toString("base64")}`);
});

test("runAudit turns failures into plain messages", async () => {
  const cfg = { baseUrl: "https://app.test", password: "" };
  await assert.rejects(runAudit("https://x.test/", cfg, async () => fakeResponse(429, { error: "slow down" }, { "retry-after": "30" })), /about 30 seconds/);
  await assert.rejects(runAudit("https://x.test/", cfg, async () => fakeResponse(429, "", {})), /Try again in a minute/);
  await assert.rejects(runAudit("https://x.test/", cfg, async () => fakeResponse(400, { error: "That address is not allowed." })), /not allowed/);
  await assert.rejects(runAudit("https://x.test/", cfg, async () => fakeResponse(502, { error: "Audit failed. Check the URL and try again." })), /Audit failed/);
  await assert.rejects(runAudit("https://x.test/", cfg, async () => fakeResponse(401, "")), /MARLO_ACCESS_PASSWORD/);
  await assert.rejects(runAudit("https://x.test/", cfg, async () => fakeResponse(500, "<html>boom</html>")), /HTTP 500/);
  await assert.rejects(runAudit("https://x.test/", cfg, async () => fakeResponse(200, { nope: true })), /does not understand/);
  await assert.rejects(runAudit("https://x.test/", cfg, async () => { throw new TypeError("fetch failed"); }), /Could not reach Marlo/);
  await assert.rejects(runAudit("https://x.test/", cfg, async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }), /took too long/);
});

test("formatAudit states only what the API returned", () => {
  const text = formatAudit(SAMPLE);
  assert.match(text, /Marlo audit of https:\/\/example\.com\/ \(HTTP 200, on-page score 71\/100\)/);
  assert.match(text, /5 issues found \(1 errors, 4 warnings\)\. Showing the top 2:/);
  assert.match(text, /1\. \[Error\] Missing page title \(On-page\)/);
  assert.match(text, /Evidence: titleLength: 0; status: 200/);
  assert.match(text, /Fix: Add a <title>/);
  assert.match(text, /auto-fixable/);
  assert.equal((text.match(/auto-fixable/g) ?? []).length, 1);
  assert.match(text, /one page only/);
});

test("formatAudit handles a clean page and missing fields", () => {
  const clean = formatAudit({ url: "https://ok.test/", findings: [], summary: { totalFindings: 0 }, technical: { onPageScore: 100, status: 200 } });
  assert.match(clean, /No issues found/);
  const sparse = formatAudit({ url: "https://s.test/", findings: [{ severity: "Warning", label: "Thing", category: "X" }] });
  assert.match(sparse, /HTTP status unknown/);
  assert.match(sparse, /1 issue found/);
});
