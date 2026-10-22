import test from "node:test";
import assert from "node:assert/strict";
import { googleOAuthQueryParams, grantedServices, scopesFor } from "../lib/googleOAuthScopes.ts";

const sensitive = /gmail|analytics|webmasters/;

test("login requests identity scopes only, never mailbox or analytics", () => {
  const scopes = scopesFor("login").split(" ");
  assert.deepEqual(scopes, ["openid", "email", "profile"]);
  assert.doesNotMatch(scopesFor("login"), sensitive);
});

test("gmail connect asks for gmail scopes but not analytics", () => {
  const s = scopesFor("gmail");
  assert.match(s, /gmail\.send/);
  assert.match(s, /gmail\.readonly/);
  assert.doesNotMatch(s, /analytics|webmasters/);
});

test("google-data connect asks for GA4 and GSC but not gmail", () => {
  const s = scopesFor("google-data");
  assert.match(s, /analytics\.readonly/);
  assert.match(s, /webmasters\.readonly/);
  assert.doesNotMatch(s, /gmail/);
});

test("login has no forced consent or offline access; connects use incremental consent", () => {
  assert.deepEqual(googleOAuthQueryParams("login"), {});
  for (const p of ["gmail", "google-data"] as const) {
    const q = googleOAuthQueryParams(p);
    assert.equal(q.include_granted_scopes, "true");
    assert.equal(q.access_type, "offline");
  }
});

test("grantedServices reads real granted scopes", () => {
  assert.deepEqual(grantedServices(["openid", "email"], false), { gmail: false, googleData: false });
  assert.deepEqual(grantedServices(scopesFor("gmail").split(" ")), { gmail: true, googleData: false });
  assert.deepEqual(grantedServices(scopesFor("google-data").split(" ")), { gmail: false, googleData: true });
});

test("unknown scopes fall back to the refresh-token signal", () => {
  assert.deepEqual(grantedServices(null, false), { gmail: false, googleData: false });
  assert.deepEqual(grantedServices(null, true), { gmail: true, googleData: true });
});
