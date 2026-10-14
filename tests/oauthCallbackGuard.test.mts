import test from "node:test";
import assert from "node:assert/strict";
import { checkOAuthCallbackOwner, OAUTH_OWNER_MISMATCH_MESSAGE } from "../lib/domain/integrations/oauthCallbackGuard.ts";

test("the signed-in user who started the flow may complete it", () => {
  assert.deepEqual(checkOAuthCallbackOwner("user-a", "user-a"), { ok: true });
});

test("session B with a state issued to user A is rejected", () => {
  assert.deepEqual(checkOAuthCallbackOwner("user-b", "user-a"), { ok: false, reason: "user_mismatch" });
});

test("no session is rejected even when the state is valid", () => {
  assert.deepEqual(checkOAuthCallbackOwner(null, "user-a"), { ok: false, reason: "no_session" });
  assert.deepEqual(checkOAuthCallbackOwner(undefined, "user-a"), { ok: false, reason: "no_session" });
  assert.deepEqual(checkOAuthCallbackOwner("", "user-a"), { ok: false, reason: "no_session" });
});

test("a state without an owner is never accepted", () => {
  assert.deepEqual(checkOAuthCallbackOwner("user-a", ""), { ok: false, reason: "user_mismatch" });
  assert.deepEqual(checkOAuthCallbackOwner("user-a", null), { ok: false, reason: "user_mismatch" });
});

test("the rejection message is generic and reveals nothing about the state", () => {
  assert.doesNotMatch(OAUTH_OWNER_MISMATCH_MESSAGE, /user|owner|state|expired/i);
});
