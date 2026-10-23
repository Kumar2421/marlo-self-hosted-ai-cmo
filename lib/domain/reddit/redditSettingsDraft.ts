/**
 * Draft + Save model for the Reddit agent settings page. Pure: no I/O, no React.
 * The page edits a local draft; nothing is sent until the user presses Save.
 */
import { normalizeRedditSettings, type RedditSettings } from "./redditSettings.ts";

function listKey(list: string[]): string {
  return list
    .map((x) => x.toLowerCase())
    .sort()
    .join("\n");
}

/** Settings as they would be stored: trimmed, de-duplicated, valid. */
export function settingsForSave(draft: RedditSettings): RedditSettings {
  return normalizeRedditSettings(draft);
}

/** True when saving the draft would change the stored settings. Order of chips and letter case of duplicates do not count. */
export function isDraftDirty(saved: RedditSettings, draft: RedditSettings): boolean {
  const a = normalizeRedditSettings(saved);
  const b = normalizeRedditSettings(draft);
  return a.country !== b.country || listKey(a.subreddits) !== listKey(b.subreddits) || listKey(a.keywords) !== listKey(b.keywords);
}

/** The draft after Discard: a copy of the saved settings. */
export function discardDraft(saved: RedditSettings): RedditSettings {
  return { ...saved, subreddits: [...saved.subreddits], keywords: [...saved.keywords] };
}

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type SaveEvent =
  | { type: "edit"; dirty: boolean }
  | { type: "save" }
  | { type: "succeeded" }
  | { type: "failed" }
  | { type: "discard" }
  | { type: "fade" };

/** idle -> dirty -> saving -> saved | error. Events that do not apply to the current status leave it unchanged. */
export function nextSaveStatus(status: SaveStatus, event: SaveEvent): SaveStatus {
  switch (event.type) {
    case "edit":
      return status === "saving" ? status : event.dirty ? "dirty" : "idle";
    case "save":
      return status === "dirty" || status === "error" ? "saving" : status;
    case "succeeded":
      return status === "saving" ? "saved" : status;
    case "failed":
      return status === "saving" ? "error" : status;
    case "discard":
      return status === "saving" ? status : "idle";
    case "fade":
      return status === "saved" ? "idle" : status;
  }
}

/** Save is allowed only with something to save and nothing in flight. */
export function canSave(status: SaveStatus): boolean {
  return status === "dirty" || status === "error";
}

export const SAVE_ERROR_MESSAGE = "Could not save. Your changes were kept so you can try again.";
