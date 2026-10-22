import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { disconnectHostedProvider } from "@/lib/hostedConnections";
import { PLATFORM_PROVIDER_KEYS, PLATFORM_DEFAULT_MODELS, hasPlatformKey, validateHostedProviderSave } from "@/lib/llm/platformKeys";
import { assertProviderBaseUrl } from "@/lib/domain/net/providerBaseUrl";
import { INVALID_USER_URL_MESSAGE } from "@/lib/domain/net/publicUrl";

/**
 * Provider connection registry (BYOK LLM keys).
 * Self-host: local SQLite, single-machine, no auth required.
 * Platform (SaaS): Supabase, one row per authenticated user, real key stored
 * in Vault (see migration 08_vault_secrets) — this table only ever holds a
 * masked preview, never the plaintext key.
 */

function maskKey(apiKey: string): string {
  return apiKey ? `${apiKey.slice(0, 4)}••••${apiKey.slice(-2)}` : "";
}

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: rows, error } = await db
      .from("provider_connections")
      .select("provider_id, key_preview, base_url, connected_at")
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "primaryModel")
      .maybeSingle();

    const connections = (rows ?? []).map((r) => ({
      providerId: r.provider_id,
      connectedAt: r.connected_at,
      baseUrl: r.base_url ?? undefined,
      keyPreview: r.key_preview,
    }));

    const platformProviders = Object.keys(PLATFORM_PROVIDER_KEYS).filter(
      (id) => hasPlatformKey(id)
    );

    // Hosted platforms need a usable model on first load, but an explicit
    // user selection must always win. Only create the default when there is
    // no saved selection and the operator has a configured platform provider.
    let primaryModel = setting?.value ?? null;
    if (!primaryModel && platformProviders.length > 0) {
      const defaultProvider = platformProviders.find((id) => PLATFORM_DEFAULT_MODELS[id]);
      const defaultModel = defaultProvider ? PLATFORM_DEFAULT_MODELS[defaultProvider] : null;

      if (defaultModel) {
        const { error: persistError } = await db.from("user_settings").upsert(
          {
            user_id: user.id,
            key: "primaryModel",
            value: defaultModel,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,key" }
        );

        // Do not block provider discovery if persistence is temporarily
        // unavailable. Return the usable default for this request; a later
        // request can retry persistence.
        if (!persistError) primaryModel = defaultModel;
        else primaryModel = defaultModel;
      }
    }

    return NextResponse.json({
      connections,
      primaryModel,
      // Providers the platform operator has configured a shared key for —
      // never the key itself, just which ids are usable without BYOK. Lets
      // the LLM Providers UI show "Included with your plan" instead of a
      // key-entry form for these, same honesty pattern as GmailCard.
      platformProviders,
    });
  }

  const db = getDb();
  const rows = db
    .prepare("SELECT provider_id, api_key, base_url, connected_at FROM provider_connections")
    .all() as { provider_id: string; api_key: string; base_url: string | null; connected_at: string }[];

  const connections = rows.map((r) => ({
    providerId: r.provider_id,
    connectedAt: r.connected_at,
    baseUrl: r.base_url ?? undefined,
    // never return the raw key to the client — empty string means "no key
    // needed" (local servers), not "key hidden"
    keyPreview: maskKey(r.api_key),
  }));

  const primaryModel = db.prepare("SELECT value FROM settings WHERE key = 'primaryModel'").get() as
    | { value: string }
    | undefined;

  return NextResponse.json({ connections, primaryModel: primaryModel?.value ?? null, platformProviders: [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.providerId !== "string") {
    return NextResponse.json({ error: "providerId is required" }, { status: 400 });
  }

  const apiKey: string = typeof body.apiKey === "string" ? body.apiKey : "";
  const baseUrl: string | null = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : null;

  // A connection needs either a real key or a base URL (local servers use a
  // URL with no key) — reject only if both are missing.
  if (!apiKey.trim() && !baseUrl) {
    return NextResponse.json({ error: "Provide an API key or a base URL" }, { status: 400 });
  }

  // A base URL is either a local model server (self-host only, see providerBaseUrl.ts) or an outbound
  // target the server calls. Checked here, at save time, and again on every use by the fetcher.
  if (baseUrl) {
    try {
      await assertProviderBaseUrl(body.providerId, baseUrl, { platformMode: FEATURES.PLATFORM_MODE });
    } catch (error) {
      const message = error instanceof Error ? error.message : INVALID_USER_URL_MESSAGE;
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (FEATURES.PLATFORM_MODE && ["github", "x", "tavily", "google_cloud"].includes(body.providerId)) {
    return NextResponse.json(
      { error: `${body.providerId} credentials are managed through their integration flow, not manual API-key configuration.` },
      { status: 400 }
    );
  }

  // LM Studio/Ollama describe a server on the CALLER's own machine — in
  // platform mode this API route runs on Vercel's servers, so accepting one
  // here would silently save a connection that can never actually be
  // reached (see ProviderCard.tsx's matching UI-level block for the full
  // reasoning). Reject server-side too, not just hide the form client-side.
  if (FEATURES.PLATFORM_MODE && (body.providerId === "lmstudio" || body.providerId === "ollama")) {
    return NextResponse.json(
      { error: `${body.providerId} only runs on your own machine — not available on a hosted deployment.` },
      { status: 400 }
    );
  }

  if (FEATURES.PLATFORM_MODE) {
    // SECURITY: a base URL without the user's own key would later be paired
    // with the operator's platform key by the LLM routes. Refuse it.
    const saveError = validateHostedProviderSave({ providerId: body.providerId, apiKey, baseUrl });
    if (saveError) return NextResponse.json({ error: saveError }, { status: 400 });

    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    let secretId: string | null = null;
    if (apiKey.trim()) {
      const { data, error } = await db.rpc("vault_set_secret", {
        p_secret: apiKey,
        p_name: `provider_key:${user.id}:${body.providerId}`,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      secretId = data as string;
    }

    const { error } = await db.from("provider_connections").upsert(
      {
        user_id: user.id,
        provider_id: body.providerId,
        base_url: baseUrl,
        key_preview: maskKey(apiKey),
        connected_at: new Date().toISOString(),
        // Always write the secret reference: a new key replaces it; no new key
        // clears it, so an old stored key can never be paired with a new base URL.
        api_key_secret_id: secretId,
      },
      { onConflict: "user_id,provider_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO provider_connections (provider_id, api_key, base_url, connected_at)
     VALUES (@providerId, @apiKey, @baseUrl, @connectedAt)
     ON CONFLICT(provider_id) DO UPDATE SET api_key = @apiKey, base_url = @baseUrl, connected_at = @connectedAt`
  ).run({ providerId: body.providerId, apiKey, baseUrl, connectedAt: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const providerId = searchParams.get("providerId");
  if (!providerId) {
    return NextResponse.json({ error: "providerId query param is required" }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Also removes the Vault secret the row points at (WordPress and every other provider).
    const result = await disconnectHostedProvider(user.id, providerId);
    if (!result.ok) return NextResponse.json({ error: "Couldn't disconnect. Try again." }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  db.prepare("DELETE FROM provider_connections WHERE provider_id = ?").run(providerId);

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.primaryModel !== "string") {
    return NextResponse.json({ error: "primaryModel is required" }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { error } = await db.from("user_settings").upsert(
      { user_id: user.id, key: "primaryModel", value: body.primaryModel, updated_at: new Date().toISOString() },
      { onConflict: "user_id,key" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('primaryModel', @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ value: body.primaryModel });

  return NextResponse.json({ ok: true });
}
