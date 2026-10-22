import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { redactSettingsForClient } from "@/lib/domain/shared/settingsRedaction";
import { validateSettingWrite } from "@/lib/domain/settings/settingsWriteRules";

/** Generic per-user KV settings (primaryModel, non-secret preferences) — the
 * platform-mode analogue of the SQLite `settings` table. OAuth tokens never
 * live here in platform mode; they're stored via Vault behind
 * integration_connections (see the auth/* callback/disconnect routes and
 * settings/google-cloud/create-key/route.ts). This set is the exact keys
 * those routes used to write into the shared `settings` table — reject them
 * here so a generic KV write never becomes a plaintext-token write. */
const OAUTH_TOKEN_KEYS = new Set([
  "gmail_access_token",
  "gmail_refresh_token",
  "ga_access_token",
  "ga_refresh_token",
  "gcp_access_token",
  "gcp_refresh_token",
  "google_cloud_api_key",
  "tavily_api_key",
  "gemini_api_key",
  "pagespeed_api_key",
  "google_cse_id",
]);

/** Reconstructs the legacy flat key/value shape the Settings UI expects from
 * the platform-mode integration_connections rows, so the frontend (out of
 * scope for this pass) keeps working unchanged. Token presence is shown as a
 * fixed masked placeholder — the real value is never decrypted just to
 * render a connected/disconnected indicator. */
async function integrationSettingsAsLegacyRows(
  db: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<{ key: string; value: string }[]> {
  const { data: allRows } = await db
    .from("integration_connections")
    .select("id, provider, project_id, external_email, external_property, access_token_secret_id, refresh_token_secret_id")
    .eq("user_id", userId);

  // ga4/gsc connections are project-scoped (a user can have Google connected
  // on more than one project) — scope those two to the active project so
  // this doesn't surface another project's connection state, or duplicate
  // ga_* keys once per connected project. gmail/gcp stay account-level
  // (project_id is always null for them), so they're unaffected.
  const { data: activeSetting } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "active_project_id")
    .maybeSingle();
  const activeProjectId = activeSetting?.value ?? null;
  const rows = allRows?.filter((r) => (r.provider === "ga4" || r.provider === "gsc" ? r.project_id === activeProjectId : true));

  const out: { key: string; value: string }[] = [];
  const placeholder = "••••••";

  // GA4/GSC selection now lives in integration_resources (selected=true row
  // per connection — see integrationStoreSupabase.ts), not the connection's
  // own external_property column, which the resource-picker redesign left
  // unused for these two providers.
  const gaConnId = rows?.find((r) => r.provider === "ga4")?.id;
  const gscConnId = rows?.find((r) => r.provider === "gsc")?.id;
  const [gaResource, gscResource] = await Promise.all([
    gaConnId
      ? db.from("integration_resources").select("resource_id, resource_name").eq("connection_id", gaConnId).eq("selected", true).maybeSingle()
      : Promise.resolve({ data: null }),
    gscConnId
      ? db.from("integration_resources").select("resource_id").eq("connection_id", gscConnId).eq("selected", true).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  for (const row of rows ?? []) {
    if (row.provider === "gmail") {
      if (row.access_token_secret_id) out.push({ key: "gmail_access_token", value: placeholder });
      if (row.refresh_token_secret_id) out.push({ key: "gmail_refresh_token", value: placeholder });
      if (row.external_email) out.push({ key: "gmail_email", value: row.external_email });
    } else if (row.provider === "ga4") {
      if (row.access_token_secret_id) out.push({ key: "ga_access_token", value: placeholder });
      if (row.refresh_token_secret_id) out.push({ key: "ga_refresh_token", value: placeholder });
      if (row.external_email) out.push({ key: "ga_email", value: row.external_email });
      if (gaResource.data?.resource_id) out.push({ key: "ga_property_id", value: gaResource.data.resource_id });
      if (gaResource.data?.resource_name) out.push({ key: "ga_property_name", value: gaResource.data.resource_name });
    } else if (row.provider === "gsc") {
      if (gscResource.data?.resource_id) out.push({ key: "gsc_site_url", value: gscResource.data.resource_id });
    } else if (row.provider === "gcp") {
      if (row.access_token_secret_id) out.push({ key: "gcp_access_token", value: placeholder });
      if (row.refresh_token_secret_id) out.push({ key: "gcp_refresh_token", value: placeholder });
      if (row.external_email) out.push({ key: "gcp_email", value: row.external_email });
      if (row.external_property) out.push({ key: "gcp_project_id", value: row.external_property });
    }
  }

  const { data: keySetting } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "google_cloud_api_key_secret_id")
    .maybeSingle();
  if (keySetting?.value) out.push({ key: "google_cloud_api_key", value: placeholder });

  return out;
}

export async function GET(req: NextRequest) {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    try {
      const db = createServiceClient();
      const { data: genericRows, error } = await db
        .from("user_settings")
        .select("key, value")
        .eq("user_id", user.id)
        .neq("key", "google_cloud_api_key_secret_id"); // internal pointer, not user-facing
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const integrationRows = await integrationSettingsAsLegacyRows(db, user.id);
      const settings = [...(genericRows ?? []), ...integrationRows];
      return NextResponse.json({ settings: redactSettingsForClient(settings) });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 500 });
    }
  }

  try {
    const db = getDb();
    const settings = db
      .prepare("SELECT key, value FROM settings WHERE key NOT IN ('ga_access_token', 'ga_refresh_token', 'ga_token_expiry')")
      .all() as { key: string; value: string }[];
    return NextResponse.json({ settings: redactSettingsForClient(settings) });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { key: rawKey, value: rawValue } = body;
  if (!rawKey) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  if ([
    "ga_access_token",
    "ga_refresh_token",
    "ga_token_expiry",
    "ga_email",
    "gsc_site_url",
    "ga_property_id",
    "ga_property_name",
  ].includes(rawKey)) {
    return NextResponse.json({ error: "Google connection data is project-scoped and cannot be stored in generic settings." }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    if (OAUTH_TOKEN_KEYS.has(rawKey)) {
      // These only ever get written by the dedicated OAuth callback / key
      // creation routes, which route them through Vault. Accepting them here
      // would mean a raw token landing in a plaintext user_settings.value
      // column.
      return NextResponse.json(
        { error: `"${rawKey}" is managed by its integration's connect flow, not by generic settings.` },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Allow-list: server-owned keys (active_project_id, primaryModel, *_secret_id, ...) are
    // written only by their own routes, never through this generic writer.
    const checked = validateSettingWrite(rawKey, rawValue, { platform: true });
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
    const { key, value } = checked;

    try {
      const db = createServiceClient();
      const { error } = await db.from("user_settings").upsert(
        { user_id: user.id, key, value, updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 500 });
    }
  }

  const checked = validateSettingWrite(rawKey, rawValue, { platform: false });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
  const { key, value } = checked;

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
    return NextResponse.json({ success: true });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
