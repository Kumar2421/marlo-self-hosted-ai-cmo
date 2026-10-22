import type { PlatformId } from "./platforms.ts";

// Per-project switches for the automatic daily drafts (one per network). Stored as the
// project_documents row social_daily_settings. Defaults are OFF for every network: the daily
// job spends the user's credits, so it only runs for a network the user turned on.

export const SOCIAL_DAILY_SETTINGS_DOC = "social_daily_settings";

export type DailyDraftSettings = Record<PlatformId, boolean>;

export const DEFAULT_DAILY_DRAFT_SETTINGS: DailyDraftSettings = { x: false, linkedin: false, reddit: false };

/** Any value that is not a real boolean keeps the default (OFF). Never throws. */
export function normalizeDailyDraftSettings(raw: unknown): DailyDraftSettings {
  const out: DailyDraftSettings = { ...DEFAULT_DAILY_DRAFT_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const platform of ["x", "linkedin", "reddit"] as const) {
    if (typeof r[platform] === "boolean") out[platform] = r[platform];
  }
  return out;
}

/** Parse the stored JSON text. Anything unreadable falls back to the defaults. */
export function parseDailyDraftSettings(content: string | null | undefined): DailyDraftSettings {
  if (!content) return normalizeDailyDraftSettings(null);
  try {
    return normalizeDailyDraftSettings(JSON.parse(content));
  } catch {
    return normalizeDailyDraftSettings(null);
  }
}

/** True when at least one network is switched on. */
export function anyDailyDraftEnabled(settings: DailyDraftSettings): boolean {
  return settings.x || settings.linkedin || settings.reddit;
}

/**
 * Projects whose saved social_daily_settings turn at least one network on. A project with no
 * saved row never opted in, so it is not here and the daily job does not touch it. Pure.
 */
export function optedInProjectIds(rows: Array<{ project_id: string; content: string | null }>): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (anyDailyDraftEnabled(parseDailyDraftSettings(row.content))) out.add(String(row.project_id));
  }
  return out;
}
