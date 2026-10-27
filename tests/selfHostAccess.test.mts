import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSelfHostAccess, passwordFromBasicHeader, safeEqual } from "../lib/security/selfHostAccess.ts";

const basic = (user: string, pass: string) => "Basic " + Buffer.from(`${user}:${pass}`, "utf8").toString("base64");

test("the gate is off when no password is configured", () => {
  for (const password of [undefined, null, "", "   "]) {
    assert.deepEqual(checkSelfHostAccess({ password, authorization: null, pathname: "/dashboard" }), { allow: true });
  }
});

test("a configured password requires matching Basic credentials", () => {
  const ok = checkSelfHostAccess({ password: "s3cret", authorization: basic("anyone", "s3cret"), pathname: "/dashboard" });
  assert.deepEqual(ok, { allow: true });
  const wrong = checkSelfHostAccess({ password: "s3cret", authorization: basic("anyone", "nope"), pathname: "/dashboard" });
  assert.equal(wrong.allow, false);
  assert.match((wrong as { challenge: string }).challenge, /^Basic realm="Marlo"/);
  assert.equal(checkSelfHostAccess({ password: "s3cret", authorization: null, pathname: "/api/project/data" }).allow, false);
});

test("the user name is ignored and the password may contain colons and unicode", () => {
  const pass = "pa:ss wörd ✓";
  assert.deepEqual(checkSelfHostAccess({ password: pass, authorization: basic("", pass), pathname: "/" }), { allow: true });
  assert.deepEqual(checkSelfHostAccess({ password: pass, authorization: basic("admin", pass), pathname: "/" }), { allow: true });
});

test("the health check path stays open", () => {
  assert.deepEqual(checkSelfHostAccess({ password: "s3cret", authorization: null, pathname: "/api/healthz" }), { allow: true });
  assert.equal(checkSelfHostAccess({ password: "s3cret", authorization: null, pathname: "/api/healthz/extra" }).allow, false);
});

test("malformed Authorization headers never pass", () => {
  for (const authorization of ["Bearer s3cret", "Basic", "Basic !!!", "Basic " + Buffer.from("nocolon").toString("base64"), "s3cret"]) {
    assert.equal(checkSelfHostAccess({ password: "s3cret", authorization, pathname: "/" }).allow, false, authorization);
  }
});

test("passwordFromBasicHeader and safeEqual behave on edge cases", () => {
  assert.equal(passwordFromBasicHeader(basic("u", "p:q")), "p:q");
  assert.equal(passwordFromBasicHeader(undefined), null);
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
});
