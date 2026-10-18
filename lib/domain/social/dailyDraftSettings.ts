import type { PlatformId } from "./platforms.ts";

// Per-project switches for the automatic daily drafts (one per network). Stored as the
// project_documents row social_daily_settings. Defaults are ON for every network.

export const SOCIAL_DAILY_SETTINGS_DOC = "social_daily_settings";

export type DailyDraftSettings = Record<PlatformId, boolean>;

export const DEFAULT_DAILY_DRAFT_SETTINGS: DailyDraftSettings = { x: true, linkedin: true, reddit: true };

/** Any value that is not a real boolean keeps the default (ON). Never throws. */
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
