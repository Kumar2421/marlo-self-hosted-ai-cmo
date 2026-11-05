import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { crawlSitePages } from "@/lib/domain/seo/SiteCrawlAgent";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { PLATFORM_DEFAULT_MODELS, platformKeyFor, resolveLlmCredential } from "@/lib/llm/platformKeys";
import { deriveOfferModel } from "@/lib/domain/offer/OfferModelAgent";
import { gatherOfferSources, type AuditForOffer } from "@/lib/domain/offer/offerSources";
import { getOfferModel as getOfferModelSqlite, saveOfferModel as saveOfferModelSqlite } from "@/lib/domain/offer/offerModelStore";
import { getOfferModel as getOfferModelSupabase, saveOfferModel as saveOfferModelSupabase } from "@/lib/domain/offer/offerModelStoreSupabase";

// One crawl of up to three key pages plus one or two model calls: allow the platform maximum (Hobby caps at 60s).
// Worst case is the page budget (15s, offerSources.ts) + two model calls (18s each) = 51s, inside the limit.
export const maxDuration = 60;

const PLATFORM_FALLBACK_PROVIDER = "groq";
const MODEL_TIMEOUT_MS = 18_000;

type ProjectRow = { id: string; name: string; url: string };

const asAuditForOffer = (payload: SEOAuditPayload): AuditForOffer => ({
  url: payload.url,
  finalUrl: payload.finalUrl,
  meta: { title: payload.meta?.title ?? "", description: payload.meta?.description ?? "" },
  bodyText: payload.bodyText ?? "",
  links: payload.links,
});

/** The stored Offer Model for a project, or null when none has been derived. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();
    const { data: project } = await db.from("projects").select("id").eq("id", id).eq("owner_id", user.id).maybeSingle();
    if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });
    return NextResponse.json({ offer: await getOfferModelSupabase(db, user.id, id) });
  }
  const db = getDb();
  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
  if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });
  return NextResponse.json({ offer: getOfferModelSqlite(db, id) });
}

/**
 * Reads the project's own site and saves an Offer Model: what it sells and who buys it, each claim backed by a
 * quote from a page Marlo read. Called from setup right after the crawl. It only pre-fills the lead profile; the
 * user still confirms it. A site that does not say is a normal outcome (offer: null), not an error.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const model: string | undefined = typeof body?.model === "string" ? body.model : undefined;
  const providerId: string | undefined = typeof body?.providerId === "string" ? body.providerId : undefined;

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();

    const { data: project, error: projectError } = await db.from("projects").select("id, name, url").eq("id", id).eq("owner_id", user.id).maybeSingle();
    if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
    if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

    const { data: auditRow, error: auditError } = await db.from("seo_audits").select("payload").eq("project_id", id).eq("url", project.url).maybeSingle();
    if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });
    if (!auditRow) return NextResponse.json({ error: "No crawl data for this project yet." }, { status: 422 });

    // A user's own connected model first; otherwise the platform's managed default, so a brand-new account still works.
    const useProviderId = providerId && model ? providerId : PLATFORM_FALLBACK_PROVIDER;
    const useModel = providerId && model ? model : PLATFORM_DEFAULT_MODELS[PLATFORM_FALLBACK_PROVIDER];
    const driver = getDriver(useProviderId);
    if (!driver || !useModel) return NextResponse.json({ error: `${useProviderId} isn't wired to a real model yet.` }, { status: 501 });

    let byokKey = "";
    let byokBaseUrl: string | null | undefined;
    if (useProviderId === providerId) {
      const { data: conn } = await db
        .from("provider_connections")
        .select("api_key_secret_id, base_url")
        .eq("user_id", user.id)
        .eq("provider_id", useProviderId)
        .maybeSingle();
      byokBaseUrl = conn?.base_url;
      if (conn?.api_key_secret_id) {
        const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
        byokKey = (secret as string) ?? "";
      }
    }
    const { apiKey, baseUrl } = resolveLlmCredential({ providerId: useProviderId, byokKey, byokBaseUrl });
    const key = apiKey || platformKeyFor(useProviderId);
    if (!key) return NextResponse.json({ error: `${useProviderId} isn't connected yet.` }, { status: 422 });

    const sources = await gatherOfferSources(asAuditForOffer(auditRow.payload as SEOAuditPayload), crawlSitePages);
    const result = await deriveOfferModel({ driver, apiKey: key, model: useModel, baseUrl, project: project as ProjectRow, sources, timeoutMs: MODEL_TIMEOUT_MS }).catch(
      (err: unknown) => ({ ok: false as const, reason: "bad_output" as const, message: err instanceof Error ? err.message : "The model call failed." }),
    );
    return finish(result, async (offer) => saveOfferModelSupabase(db, user.id, id, offer));
  }

  // Self-host: the user's own connected model, from local settings.
  const db = getDb();
  const project = db.prepare("SELECT id, name, url FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });
  if (!model || !providerId) return NextResponse.json({ error: "No model selected." }, { status: 422 });

  const auditRow = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(project.url) as { payload: string } | undefined;
  if (!auditRow) return NextResponse.json({ error: "No crawl data for this project yet." }, { status: 422 });

  const driver = getDriver(providerId);
  if (!driver) return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
  const conn = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as { api_key: string; base_url: string | null } | undefined;
  if (!conn) return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });

  const sources = await gatherOfferSources(asAuditForOffer(JSON.parse(auditRow.payload) as SEOAuditPayload), crawlSitePages);
  const result = await deriveOfferModel({
    driver,
    apiKey: conn.api_key,
    model,
    baseUrl: conn.base_url ?? undefined,
    project,
    sources,
    timeoutMs: MODEL_TIMEOUT_MS,
  }).catch((err: unknown) => ({ ok: false as const, reason: "bad_output" as const, message: err instanceof Error ? err.message : "The model call failed." }));
  return finish(result, async (offer) => saveOfferModelSqlite(db, id, offer));
}

type DeriveOutcome = Awaited<ReturnType<typeof deriveOfferModel>>;

async function finish(result: DeriveOutcome, save: (offer: Extract<DeriveOutcome, { ok: true }>["offer"]) => Promise<void> | void) {
  if (result.ok) {
    try {
      await save(result.offer);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save the offer model." }, { status: 500 });
    }
    return NextResponse.json({ offer: result.offer, dropped: result.dropped });
  }
  // "The site does not say" is a real answer, not a failure: setup records the step as done and the wizard falls back.
  if (result.reason === "nothing_found") return NextResponse.json({ offer: null, reason: result.reason, message: result.message });
  return NextResponse.json({ error: result.message, reason: result.reason }, { status: result.reason === "no_sources" ? 422 : 502 });
}
