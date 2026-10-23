import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_ONLY_COOKIE,
  applySessionPersistence,
  isProtectedPath,
  isSessionOnly,
  isTransientAuthError,
  parseCookieHeader,
  sessionMarkerCookie,
} from "../utils/supabase/sessionPersistence.ts";

const defaults = { path: "/", sameSite: "lax" as const, maxAge: 34560000 };

test("remembered sessions keep the persistent maxAge", () => {
  assert.deepEqual(applySessionPersistence(defaults, false), defaults);
});

test("session-only drops maxAge and expires but keeps other options", () => {
  const out = applySessionPersistence({ ...defaults, expires: new Date(Date.now() + 1e6) }, true);
  assert.deepEqual(out, { path: "/", sameSite: "lax" });
});

test("session-only still lets cookies be deleted", () => {
  assert.equal(applySessionPersistence({ ...defaults, maxAge: 0 }, true)?.maxAge, 0);
  const past = new Date(Date.now() - 1000);
  assert.equal(applySessionPersistence({ path: "/", expires: past }, true)?.expires, past);
});

test("applySessionPersistence passes undefined through and does not mutate input", () => {
  assert.equal(applySessionPersistence(undefined, true), undefined);
  const input = { ...defaults };
  applySessionPersistence(input, true);
  assert.equal(input.maxAge, 34560000);
});

test("marker cookie detects session-only choice", () => {
  assert.equal(isSessionOnly([{ name: SESSION_ONLY_COOKIE, value: "1" }]), true);
  assert.equal(isSessionOnly([{ name: SESSION_ONLY_COOKIE, value: "" }]), false);
  assert.equal(isSessionOnly([{ name: "other", value: "1" }]), false);
});

test("marker cookie string is a session cookie when unticked and cleared when ticked", () => {
  const off = sessionMarkerCookie(false);
  assert.match(off, /^marlo_session_only=1;/);
  assert.doesNotMatch(off, /max-age|expires/i);
  assert.match(sessionMarkerCookie(true), /max-age=0/);
  const parsed = parseCookieHeader("a=1; marlo_session_only=1; b=x=y");
  assert.equal(isSessionOnly(parsed), true);
  assert.deepEqual(parsed[2], { name: "b", value: "x=y" });
});

test("transient auth errors are not treated as signed out", () => {
  assert.equal(isTransientAuthError({ name: "AuthRetryableFetchError", status: 0 }), true);
  assert.equal(isTransientAuthError({ status: 503 }), true);
  assert.equal(isTransientAuthError({ status: 429 }), true);
  assert.equal(isTransientAuthError({ name: "AuthApiError", status: 401 }), false);
  assert.equal(isTransientAuthError({ name: "AuthSessionMissingError", status: 400 }), false);
  assert.equal(isTransientAuthError(null), false);
});

test("only the app routes are protected; terms, privacy and login are public", () => {
  assert.equal(isProtectedPath("/dashboard"), true);
  assert.equal(isProtectedPath("/dashboard/x"), true);
  assert.equal(isProtectedPath("/settings"), true);
  for (const p of ["/", "/login", "/terms", "/privacy", "/api/auth/callback", "/dashboardish"]) {
    assert.equal(isProtectedPath(p), false, p);
  }
});
