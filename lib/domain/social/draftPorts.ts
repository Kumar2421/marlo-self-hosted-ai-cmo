/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Server-side port wiring for the social draft agents (X, LinkedIn, Reddit).
 * The draft routes and the daily job both build their ports here, so the
 * model call, credit charge, daily batch slot and storage rules live once.
 * Platform (Supabase) and self-host (SQLite) are both handled.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db.ts";
import { getDriver } from "@/lib/llm/index.ts";
import { PLATFORM_DEFAULT_MODELS, PLATFORM_PROVIDER_KEYS } from "@/lib/llm/platformKeys.ts";
import { getUserPlan } from "@/lib/entitlements.ts";
import { chargeCredits, getCreditState } from "@/lib/credits.ts";
import { dailyDraftBatchLimit } from "@/lib/domain/x/xDraftTypes.ts";
import { isWithinLimit, parseDraftBatch } from "@/lib/domain/x/draftPost.ts";
import * as xSqlite from "@/lib/domain/x/xDraftStore.ts";
import * as xSupabase from "@/lib/domain/x/xDraftStoreSupabase.ts";
import * as liSqlite from "@/lib/domain/linkedin/linkedInDraftStore.ts";
import * as liSupabase from "@/lib/domain/linkedin/linkedInDraftStoreSupabase.ts";
import * as redSqlite from "@/lib/domain/reddit/redditDraftStore.ts";
import * as redSupabase from "@/lib/domain/reddit/redditDraftStoreSupabase.ts";
import { getRedditSettings } from "@/lib/domain/reddit/redditSettingsStore.ts";
import { getRedditSettings as getRedditSettingsSupabase } from "@/lib/domain/reddit/redditSettingsStoreSupabase.ts";
import { parseLinkedInBatch, parseRedditBatch } from "./draftParse.ts";
import { generateDraftBatch, type DraftGenerationPorts, type DraftGenerationResult, type Reservation, type ReservationFailure } from "./draftGeneration.ts";
import type { PlatformId } from "./platforms.ts";

export type DraftScope =
  | { mode: "platform"; db: SupabaseClient; userId: string; projectId: string }
  | { mode: "selfhost"; projectId: string };

/** Which model key a draft call uses: the user's own (BYOK, no credits) or the platform's (metered). */
export type ModelAccess = { apiKey: string; baseUrl?: string; usesPlatformKey: boolean };

export const DRAFT_PROVIDER_ID = "groq";
const SOCIAL_CREDIT_AGENT = "social_draft";

export type ParsedBatch = { drafts: unknown[]; errors?: unknown[] };

export function startOfUtcDay(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Platform mode: the user's saved Groq key if any, otherwise the platform key (metered). */
export async function resolvePlatformModelAccess(db: SupabaseClient, userId: string): Promise<ModelAccess> {
  const { data: conn } = await db.from("provider_connections").select("api_key_secret_id, base_url")
    .eq("user_id", userId).eq("provider_id", DRAFT_PROVIDER_ID).maybeSingle();
  if (conn?.api_key_secret_id) {
    const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
    return { apiKey: (secret as string) ?? "", baseUrl: conn.base_url ?? undefined, usesPlatformKey: false };
  }
  const platformKey = PLATFORM_PROVIDER_KEYS[DRAFT_PROVIDER_ID];
  if (platformKey) return { apiKey: platformKey, usesPlatformKey: true };
  return { apiKey: "", usesPlatformKey: false };
}

/** Self-host: the key saved in local settings. */
export function selfHostModelAccess(): ModelAccess {
  const row = getDb().prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(DRAFT_PROVIDER_ID) as
    | { api_key: string; base_url: string | null } | undefined;
  if (!row) return { apiKey: "", usesPlatformKey: false };
  return { apiKey: row.api_key, baseUrl: row.base_url ?? undefined, usesPlatformKey: false };
}

/** Daily batch cap per network and project; only the platform key is capped (-1 = unlimited). */
export async function draftLimitFor(scope: DraftScope, access: ModelAccess): Promise<number> {
  if (scope.mode === "platform" && access.usesPlatformKey) return dailyDraftBatchLimit(await getUserPlan(scope.userId));
  return -1;
}

/** The project's default subreddit from saved Reddit settings ("" when none). Never throws. */
export async function defaultSubredditFor(scope: DraftScope): Promise<string> {
  try {
    const settings = scope.mode === "platform"
      ? await getRedditSettingsSupabase(scope.db, scope.userId, scope.projectId)
      : getRedditSettings(getDb(), scope.projectId);
    if (settings.subreddits.length > 0) return settings.subreddits[0].replace(/^r\//, "");
  } catch {
    // Ignore errors; no default subreddit.
  }
  return "";
}

/** Parser for a network's model output (the same validation the routes always used). */
export function parserFor(platform: PlatformId, variants: number): (text: string) => ParsedBatch {
  if (platform === "x") return (text) => parseDraftBatch(text, variants);
  if (platform === "linkedin") return (text) => parseLinkedInBatch(text, variants);
  return (text) => parseRedditBatch(text, variants);
}

type PlatformAdapter = {
  reserve(db: SupabaseClient, userId: string, projectId: string, limit: number, sinceIso: string): Promise<Reservation | ReservationFailure>;
  remove(db: SupabaseClient, userId: string, projectId: string, batchId: string): Promise<void>;
  fulfil(db: SupabaseClient, userId: string, projectId: string, batchId: string, drafts: any[]): Promise<unknown[]>;
  insert(db: SupabaseClient, userId: string, projectId: string, drafts: any[]): Promise<unknown[]>;
  insertLocal(projectId: string, drafts: any[]): unknown[];
  /** LinkedIn and Reddit rows carry fixed angle and why-this-works defaults. */
  withDefaults: boolean;
  filterUsable(drafts: any[]): unknown[];
};

const ADAPTERS: Record<PlatformId, PlatformAdapter> = {
  x: {
    reserve: xSupabase.reserveXBatch,
    remove: xSupabase.deleteXBatch,
    fulfil: xSupabase.fulfilXBatch,
    insert: xSupabase.insertXDrafts,
    insertLocal: (projectId, drafts) => xSqlite.insertXDrafts(getDb(), projectId, drafts),
    withDefaults: false,
    filterUsable: (drafts) => drafts.filter((d) => isWithinLimit(d.text)),
  },
  linkedin: {
    reserve: liSupabase.reserveLinkedInBatch,
    remove: liSupabase.deleteLinkedInBatch,
    fulfil: liSupabase.fulfilLinkedInBatch,
    insert: liSupabase.insertLinkedInDrafts,
    insertLocal: (projectId, drafts) => liSqlite.insertLinkedInDrafts(getDb(), projectId, drafts),
    withDefaults: true,
    filterUsable: (drafts) => drafts,
  },
  reddit: {
    reserve: redSupabase.reserveRedditBatch,
    remove: redSupabase.deleteRedditBatch,
    fulfil: redSupabase.fulfilRedditBatch,
    insert: redSupabase.insertRedditDrafts,
    insertLocal: (projectId, drafts) => redSqlite.insertRedditDrafts(getDb(), projectId, drafts),
    withDefaults: true,
    filterUsable: (drafts) => drafts,
  },
};

export type DraftBuildConfig = {
  access: ModelAccess;
  /** From draftLimitFor(). */
  limit: number;
  variants: number;
  system: string;
  prompt: string;
  /** Defaults to the network's own parser for `variants`. */
  parse?: (text: string) => ParsedBatch;
};

/** The generateDraftBatch ports for one network, in either mode. */
export function buildDraftPorts(platform: PlatformId, scope: DraftScope, cfg: DraftBuildConfig): DraftGenerationPorts {
  const adapter = ADAPTERS[platform];
  const { access, system, prompt } = cfg;
  const ps = scope.mode === "platform" ? scope : null;
  const parse = cfg.parse ?? parserFor(platform, cfg.variants);

  return {
    creditState: async () => (ps ? getCreditState(ps.userId, SOCIAL_CREDIT_AGENT) : { billingEnabled: false, balance: 0, cost: 0 }),
    isByok: !access.usesPlatformKey,
    limit: cfg.limit,
    reserveSlot: async (limit) => {
      if (!ps) return { ok: true, batchId: "" };
      return adapter.reserve(ps.db, ps.userId, ps.projectId, limit, startOfUtcDay());
    },
    releaseSlot: async (batchId) => {
      if (ps && batchId) await adapter.remove(ps.db, ps.userId, ps.projectId, batchId).catch(() => {});
    },
    callModel: async () => {
      const driver = getDriver(DRAFT_PROVIDER_ID);
      if (!driver) throw new Error("Groq isn't wired to a real model yet.");
      const result = await driver({
        apiKey: access.apiKey,
        baseUrl: access.baseUrl,
        system,
        model: PLATFORM_DEFAULT_MODELS[DRAFT_PROVIDER_ID],
        stream: false,
        messages: [{ role: "user", content: prompt }],
      });
      return result.text ?? "";
    },
    parse,
    filterUsable: (drafts) => adapter.filterUsable(drafts as any[]),
    insertDrafts: async (batchId, drafts) => {
      const rows = adapter.withDefaults ? (drafts as any[]).map((d) => ({ ...d, angle: "General", whyThisWorks: "" })) : (drafts as any[]);
      if (ps) {
        return batchId
          ? adapter.fulfil(ps.db, ps.userId, ps.projectId, batchId, rows)
          : adapter.insert(ps.db, ps.userId, ps.projectId, rows);
      }
      return adapter.insertLocal(scope.projectId, rows);
    },
    deleteBatch: async (batchId) => {
      if (ps) await adapter.remove(ps.db, ps.userId, ps.projectId, batchId).catch(() => {});
    },
    charge: async () => {
      if (access.usesPlatformKey && ps) {
        await chargeCredits(ps.userId, SOCIAL_CREDIT_AGENT, { projectId: ps.projectId, model: PLATFORM_DEFAULT_MODELS[DRAFT_PROVIDER_ID] });
      }
    },
  };
}

/** Run one generation for one network. */
export async function generateForPlatform(platform: PlatformId, scope: DraftScope, cfg: DraftBuildConfig): Promise<DraftGenerationResult> {
  return generateDraftBatch(buildDraftPorts(platform, scope, cfg), { variants: cfg.variants });
}
