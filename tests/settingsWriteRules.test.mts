import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SETTING_VALUE_BYTES, SETTING_REJECTED_MESSAGE, isSelfHostOnlyKey, validateSettingWrite } from "../lib/domain/settings/settingsWriteRules.ts";

const platform = { platform: true };
const selfHost = { platform: false };

test("accepts the keys the settings UI really writes", () => {
  for (const key of ["personalization_name", "personalization_notes", "onboarding_completed", "agents_region", "agents_toggle_seo", "agents_toggle_articles", "auto_discover_competitors", "github_repo"]) {
    assert.deepEqual(validateSettingWrite(key, "x", platform), { ok: true, key, value: "x" }, key);
  }
  assert.equal(validateSettingWrite("agents_toggle_seo", "", platform).ok, true, "clearing with an empty string is allowed");
});

test("rejects server-managed keys with the fixed message", () => {
  for (const key of ["active_project_id", "primaryModel", "google_cloud_api_key_secret_id", "notification_preferences", "gmail_refresh_token", "agents_toggle_unknown"]) {
    const r = validateSettingWrite(key, "00000000-0000-0000-0000-000000000000", platform);
    assert.equal(r.ok, false, key);
    if (!r.ok) {
      assert.equal(r.status, 400);
      assert.equal(r.error, SETTING_REJECTED_MESSAGE);
      assert.ok(!r.error.includes(key));
    }
  }
  assert.equal(validateSettingWrite("active_project_id", "x", selfHost).ok, false);
});

test("rejects prototype-pollution-ish and malformed keys", () => {
  for (const key of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "", " personalization_name", "personalization_name\n", "agents_toggle_seo ", "PERSONALIZATION_NAME"]) {
    assert.equal(validateSettingWrite(key, "x", platform).ok, false, JSON.stringify(key));
    assert.equal(validateSettingWrite(key, "x", selfHost).ok, false, JSON.stringify(key));
  }
});

test("rejects non-string keys and values", () => {
  for (const bad of [null, undefined, 1, true, {}, [], ["personalization_name"]]) {
    assert.equal(validateSettingWrite(bad, "x", platform).ok, false);
    assert.equal(validateSettingWrite("personalization_name", bad, platform).ok, false);
  }
});

test("caps value size at 20 KB in bytes, not characters", () => {
  const atLimit = "a".repeat(MAX_SETTING_VALUE_BYTES);
  assert.equal(validateSettingWrite("personalization_notes", atLimit, platform).ok, true);
  const over = validateSettingWrite("personalization_notes", atLimit + "a", platform);
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.status, 413);
  // 7000 three-byte characters are under 20000 chars but over 20 KB.
  assert.equal(validateSettingWrite("personalization_notes", "€".repeat(7000), platform).ok, false);
});

test("integration secrets are writable only in self-host mode", () => {
  for (const key of ["tavily_api_key", "gemini_api_key", "pagespeed_api_key", "google_cloud_api_key", "google_cse_id", "github_pat"]) {
    assert.equal(isSelfHostOnlyKey(key), true);
    assert.equal(validateSettingWrite(key, "k", selfHost).ok, true, key);
    assert.equal(validateSettingWrite(key, "k", platform).ok, false, key);
  }
  assert.equal(isSelfHostOnlyKey("personalization_name"), false);
});
