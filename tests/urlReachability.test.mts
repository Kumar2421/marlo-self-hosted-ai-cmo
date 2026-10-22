import test from "node:test";
import assert from "node:assert/strict";
import { classifyReachability } from "../lib/domain/shared/urlReachability.ts";

test("any 2xx answer is reachable", () => {
  assert.deepEqual(classifyReachability({ status: 200 }), { verdict: "reachable" });
  assert.deepEqual(classifyReachability({ status: 204 }), { verdict: "reachable" });
});

test("bot-protection and rate-limit statuses are reachable but unverified, not rejected", () => {
  for (const status of [401, 403, 429]) {
    assert.equal(classifyReachability({ status }).verdict, "unverified", `status ${status}`);
  }
});

test("server errors are unverified, so a briefly-down site is not blocked", () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(classifyReachability({ status }).verdict, "unverified", `status ${status}`);
  }
});

test("timeouts are unverified", () => {
  assert.equal(classifyReachability({ errorCode: "network:timeout" }).verdict, "unverified");
});

test("unexpected redirect problems and unknown failures are unverified", () => {
  assert.equal(classifyReachability({ errorCode: "redirect:limit" }).verdict, "unverified");
  assert.equal(classifyReachability({ errorCode: "redirect:invalid" }).verdict, "unverified");
  assert.equal(classifyReachability({ errorCode: "unknown" }).verdict, "unverified");
  assert.equal(classifyReachability({}).verdict, "unverified");
});

test("a DNS failure is unreachable with a plain message", () => {
  const out = classifyReachability({ errorCode: "dns:failed" });
  assert.equal(out.verdict, "unreachable");
  assert.match(out.message ?? "", /couldn't find a website/);
});

test("a refused or failed connection is unreachable", () => {
  const out = classifyReachability({ errorCode: "network:error" });
  assert.equal(out.verdict, "unreachable");
  assert.match(out.message ?? "", /couldn't connect/);
});

test("blocked or invalid addresses are unreachable (SSRF policy codes)", () => {
  for (const errorCode of ["policy:url", "policy:scheme", "policy:address", "policy:credentials"]) {
    const out = classifyReachability({ errorCode });
    assert.equal(out.verdict, "unreachable", errorCode);
    assert.match(out.message ?? "", /can't be used/);
  }
});

test("a page that answers not-found is unreachable and names the status", () => {
  const out = classifyReachability({ status: 404 });
  assert.equal(out.verdict, "unreachable");
  assert.match(out.message ?? "", /HTTP 404/);
});

test("only unreachable results carry a message", () => {
  assert.equal(classifyReachability({ status: 200 }).message, undefined);
  assert.equal(classifyReachability({ status: 403 }).message, undefined);
  assert.equal(classifyReachability({ errorCode: "network:timeout" }).message, undefined);
});
