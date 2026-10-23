// What the generic /api/settings POST may write. The route is a key-value writer
// reachable by any signed-in user, so it only accepts the keys the Settings UI really
// saves. Server-managed keys (active_project_id, primaryModel, *_secret_id, notification
// preferences, ...) are written only by their own routes and are rejected here.

/** Largest value a client may store in one setting. */
export const MAX_SETTING_VALUE_BYTES = 20 * 1024;

/** Fixed message for every rejection: never echoes the key or value back. */
export const SETTING_REJECTED_MESSAGE = "This setting cannot be changed here.";
export const SETTING_TOO_LARGE_MESSAGE = "Setting value is too large.";

const AGENT_TOGGLE_IDS = ["seo", "reddit", "x", "linkedin", "articles"];

/** Plain preferences the UI saves in every mode. The personalization_* (except the
 * onboarding role), agents_region, agents_reddit_prompt and agents_toggle_* keys are
 * no longer written by any UI (nothing read them); they stay allowed so existing
 * rows and older clients keep working. */
const PREFERENCE_KEYS: readonly string[] = [
  "personalization_name",
  "personalization_role",
  "personalization_notes",
  "personalization_language",
  "onboarding_source",
  "onboarding_completed",
  "agents_region",
  "agents_reddit_prompt",
  "auto_discover_competitors",
  "github_repo",
  ...AGENT_TOGGLE_IDS.map((id) => `agents_toggle_${id}`),
];

/** Keys the Settings cards write only in self-host mode (local SQLite). On the hosted
 * platform these are secrets and are stored through Vault by their own flows. */
const SELF_HOST_ONLY_KEYS: readonly string[] = [
  "gemini_api_key",
  "tavily_api_key",
  "pagespeed_api_key",
  "google_cloud_api_key",
  "google_cse_id",
  "github_pat",
];

const PREFERENCES = new Set<string>(PREFERENCE_KEYS);
const SELF_HOST_ONLY = new Set<string>(SELF_HOST_ONLY_KEYS);

export type SettingWrite = { ok: true; key: string; value: string } | { ok: false; error: string; status: 400 | 413 };

/** True when this key is a secret/integration key owned by its own connect flow on the platform. */
export function isSelfHostOnlyKey(key: string): boolean {
  return SELF_HOST_ONLY.has(key);
}

export function validateSettingWrite(rawKey: unknown, rawValue: unknown, opts: { platform: boolean }): SettingWrite {
  if (typeof rawKey !== "string" || typeof rawValue !== "string") {
    return { ok: false, error: SETTING_REJECTED_MESSAGE, status: 400 };
  }
  // Set.has on exact strings: "__proto__", "constructor" and friends are simply not members.
  const allowed = PREFERENCES.has(rawKey) || (!opts.platform && SELF_HOST_ONLY.has(rawKey));
  if (!allowed) return { ok: false, error: SETTING_REJECTED_MESSAGE, status: 400 };
  if (Buffer.byteLength(rawValue, "utf8") > MAX_SETTING_VALUE_BYTES) {
    return { ok: false, error: SETTING_TOO_LARGE_MESSAGE, status: 413 };
  }
  return { ok: true, key: rawKey, value: rawValue };
}
