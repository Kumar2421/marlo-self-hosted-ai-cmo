import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver, type LlmDriver } from "@/lib/llm";
import { PLATFORM_PROVIDER_KEYS } from "@/lib/llm/platformKeys";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { assertPublicHttpUrl } from "@/lib/domain/seo/SEOAgent";
import { getProjectFinding } from "@/lib/domain/findings/findingStore";
import { getProjectFinding as getProjectFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import type { Finding } from "@/lib/domain/findings/findingTypes";
import { createAction, listProjectActions } from "@/lib/domain/actions/actionStore";
import { createAction as createActionSupabase, listProjectActions as listProjectActionsSupabase } from "@/lib/domain/actions/actionStoreSupabase";
import { deriveActionType } from "@/lib/domain/actions/deriveActionType";
import { implementAction, type OutcomePorts } from "@/lib/domain/search/outcomeService";
import { platformOutcomePorts, selfHostOutcomePorts } from "@/lib/domain/search/outcomePorts";
import { assertPublicCmsUrl, type CmsFetchOptions } from "@/lib/domain/cms/cmsFetch";
import { CMS_LABEL, type CmsId, type CmsPublisher } from "@/lib/domain/cms/cmsFixCatalog";
import { WordPressPublisher } from "@/lib/domain/cms/wordpressPublisher";
import { WebflowPublisher } from "@/lib/domain/cms/webflowPublisher";

/**
 * Server steps shared by the CMS fix routes (prepare, revise, apply) and the Webflow connection
 * routes: who is asking, which project/finding, the saved CMS connection (secrets read from the
 * same store as the WordPress card: Vault in hosted mode, the local provider_connections row when
 * self-hosting), the model, and recording an applied fix against the finding's tracked action.
 * Secrets are never logged or returned.
 */

export const cmsNet: CmsFetchOptions = {
  // DNS is resolved and checked by the pinned transport on every hop (see cmsFetch.ts).
  assertUrl: (u) => void assertPublicCmsUrl(u, assertPublicHttpUrl),
};

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

const WEBFLOW_CONFIG_KEY = "cms_webflow_config";

export type WebflowSelection = { siteId: string; siteName: string; collectionId: string; collectionName: string };
export type CmsConnection = { cms: CmsId; label: string; detail: string };

type Store = {
  userId: string | null;
  /** The saved secret and base URL for a provider id, or null. */
  readConnection(providerId: string): Promise<{ secret: string; baseUrl: string | null } | null>;
  readSetting(key: string): Promise<string | null>;
};

function selfHostStore(): Store {
  const db = getDb();
  return {
    userId: null,
    async readConnection(providerId) {
      const row = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as { api_key: string; base_url: string | null } | undefined;
      return row?.api_key ? { secret: row.api_key, baseUrl: row.base_url } : null;
    },
    async readSetting(key) {
      return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
    },
  };
}

function hostedStore(userId: string): Store {
  const db = createServiceClient();
  return {
    userId,
    async readConnection(providerId) {
      const { data: conn } = await db.from("provider_connections").select("api_key_secret_id, base_url").eq("user_id", userId).eq("provider_id", providerId).maybeSingle();
      if (!conn?.api_key_secret_id) return null;
      const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
      return secret ? { secret: secret as string, baseUrl: conn.base_url ?? null } : null;
    },
    async readSetting(key) {
      const { data } = await db.from("user_settings").select("value").eq("user_id", userId).eq("key", key).maybeSingle();
      return (data?.value as string | undefined) ?? null;
    },
  };
}

/** The signed-in user's store (or the local one), or a 401 response. */
export async function resolveStore(): Promise<Store | NextResponse> {
  if (!FEATURES.PLATFORM_MODE) return selfHostStore();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated", 401);
  return hostedStore(user.id);
}

function parseWebflowSelection(raw: string | null): WebflowSelection | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<WebflowSelection> | null;
    if (v && typeof v.siteId === "string" && typeof v.collectionId === "string") {
      return { siteId: v.siteId, collectionId: v.collectionId, siteName: String(v.siteName ?? ""), collectionName: String(v.collectionName ?? "") };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function readWebflowSelection(store: Store): Promise<WebflowSelection | null> {
  return parseWebflowSelection(await store.readSetting(WEBFLOW_CONFIG_KEY));
}

export const WEBFLOW_CONFIG_SETTING = WEBFLOW_CONFIG_KEY;

/** Builds the adapter for a connected CMS, or null when it is not connected. */
export async function publisherFor(store: Store, cms: CmsId): Promise<CmsPublisher | null> {
  if (cms === "wordpress") {
    const conn = await store.readConnection("wordpress");
    return conn?.baseUrl ? new WordPressPublisher({ baseUrl: conn.baseUrl, credentials: conn.secret }, cmsNet) : null;
  }
  const [conn, sel] = [await store.readConnection("webflow"), await readWebflowSelection(store)];
  return conn && sel ? new WebflowPublisher({ token: conn.secret, siteId: sel.siteId, collectionId: sel.collectionId }, cmsNet) : null;
}

/** Which CMSs are connected, without reading any secret into the response. */
export async function connectedCms(store: Store): Promise<CmsConnection[]> {
  const out: CmsConnection[] = [];
  const wp = await store.readConnection("wordpress");
  if (wp?.baseUrl) out.push({ cms: "wordpress", label: CMS_LABEL.wordpress, detail: wp.baseUrl });
  const [wf, sel] = [await store.readConnection("webflow"), await readWebflowSelection(store)];
  if (wf && sel) out.push({ cms: "webflow", label: CMS_LABEL.webflow, detail: `${sel.siteName || "Webflow site"} / ${sel.collectionName || "collection"}` });
  return out;
}

export type CmsLlm = { driver: LlmDriver; apiKey: string; baseUrl?: string };

export type CmsRequest = {
  userId: string | null;
  projectId: string;
  projectName: string;
  projectUrl: string | null;
  finding: Finding;
  store: Store;
  llm(providerId: string): Promise<CmsLlm | NextResponse>;
  /** Hosted only: meters the model call. Returns an error response when out of credits. */
  charge(model: string): Promise<NextResponse | null>;
  /** The page as the public sees it right now (call BEFORE writing, for the outcome baseline). */
  fingerprint(url: string): Promise<Awaited<ReturnType<OutcomePorts["fetchFingerprint"]>>>;
  /** After the CMS write: log it against the finding's tracked action so before/after measurement starts. */
  recordApplied(args: { cms: CmsId; summary: string; pageBefore: Awaited<ReturnType<OutcomePorts["fetchFingerprint"]>> }): Promise<{ tracked: boolean }>;
};

export async function resolveCmsRequest(findingId: string): Promise<CmsRequest | NextResponse> {
  if (!FEATURES.PLATFORM_MODE) {
    const projectId = getActiveProjectId();
    if (!projectId) return fail("No active project - add a website first.", 422);
    const project = getDb().prepare("SELECT name, url FROM projects WHERE id = ?").get(projectId) as { name: string; url: string | null } | undefined;
    const finding = getProjectFinding(projectId, findingId);
    if (!finding) return fail("Finding not found.", 404);
    const ports = selfHostOutcomePorts(projectId, project?.url ?? null);
    return {
      userId: null,
      projectId,
      projectName: project?.name ?? "",
      projectUrl: project?.url ?? null,
      finding,
      store: selfHostStore(),
      llm: async (providerId) => {
        const driver = getDriver(providerId);
        if (!driver) return fail(`${providerId} isn't wired to a real model yet.`, 501);
        const row = getDb().prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as { api_key: string; base_url: string | null } | undefined;
        if (!row) return fail(`${providerId} isn't connected yet. Connect it in Settings > LLM Providers.`, 422);
        return { driver, apiKey: row.api_key, baseUrl: row.base_url ?? undefined };
      },
      charge: async () => null,
      fingerprint: (url) => ports.fetchFingerprint(url),
      recordApplied: async ({ cms, summary, pageBefore }) => {
        const actions = listProjectActions(projectId, finding.id);
        const open = actions.find((a) => a.status === "proposed" || a.status === "approved");
        const action =
          open ??
          createAction({
            projectId, findingId: finding.id, type: deriveActionType(finding), title: `Fix in ${CMS_LABEL[cms]}: ${finding.recommendation.slice(0, 80)}`,
            target: { url: finding.url ?? undefined }, parameters: { via: "cms_publish", cms },
          });
        const res = await implementAction(ports, { actionId: action.id, via: "cms_publish", change: { summary }, pageBefore });
        return { tracked: res.ok };
      },
    };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated", 401);
  const db = createServiceClient();
  const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
  if (!setting?.value) return fail("No active project - add a website first.", 422);
  const { data: project } = await db.from("projects").select("id, name, url").eq("id", setting.value).eq("owner_id", user.id).maybeSingle();
  if (!project) return fail("No active project - add a website first.", 422);
  const finding = await getProjectFindingSupabase(db, user.id, project.id, findingId);
  if (!finding) return fail("Finding not found.", 404);
  const ports = platformOutcomePorts(db, user.id, project.id, project.url ?? null);
  return {
    userId: user.id,
    projectId: project.id,
    projectName: project.name,
    projectUrl: project.url ?? null,
    finding,
    store: hostedStore(user.id),
    llm: async (providerId) => {
      const driver = getDriver(providerId);
      if (!driver) return fail(`${providerId} isn't wired to a real model yet.`, 501);
      const { data: conn } = await db.from("provider_connections").select("api_key_secret_id, base_url").eq("user_id", user.id).eq("provider_id", providerId).maybeSingle();
      let apiKey = "";
      if (conn?.api_key_secret_id) {
        const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
        apiKey = (secret as string) ?? "";
      }
      if (!apiKey) apiKey = PLATFORM_PROVIDER_KEYS[providerId] ?? "";
      if (!apiKey) return fail(`${providerId} isn't connected yet. Connect it in Settings > LLM Providers.`, 422);
      return { driver, apiKey, baseUrl: conn?.base_url ?? undefined };
    },
    charge: async (model) => {
      try {
        await chargeCredits(user.id, "code_fix", { projectId: project.id, model });
        return null;
      } catch (err) {
        if (err instanceof InsufficientCreditsError) return fail("Out of credits. Upgrade or connect your own key.", 402);
        throw err;
      }
    },
    fingerprint: (url) => ports.fetchFingerprint(url),
    recordApplied: async ({ cms, summary, pageBefore }) => {
      const actions = await listProjectActionsSupabase(db, user.id, project.id, finding.id);
      const open = actions.find((a) => a.status === "proposed" || a.status === "approved");
      const action =
        open ??
        (await createActionSupabase(db, user.id, {
          projectId: project.id, findingId: finding.id, type: deriveActionType(finding), title: `Fix in ${CMS_LABEL[cms]}: ${finding.recommendation.slice(0, 80)}`,
          target: { url: finding.url ?? undefined }, parameters: { via: "cms_publish", cms },
        }));
      const res = await implementAction(ports, { actionId: action.id, via: "cms_publish", change: { summary }, pageBefore });
      return { tracked: res.ok };
    },
  };
}

/** Wraps a thrown CmsError (safe message) or anything else into a response; unknown errors get a generic message. */
export function cmsErrorResponse(err: unknown, fallback: string): NextResponse {
  const e = err as { name?: string; message?: string; status?: number } | null;
  if (e?.name === "CmsError" && e.message) return fail(e.message, e.status ?? 422);
  return fail(fallback, 500);
}
