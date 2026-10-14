/**
 * Pure helpers for the top-bar Social menu and for notifications that open a
 * network's draft panel. No React, no I/O, so they can be tested directly.
 */
import type { PlatformId } from "./platforms";

export const SOCIAL_NAV_PLATFORMS: readonly PlatformId[] = ["x", "linkedin", "reddit"];

export const DEFAULT_SOCIAL_PLATFORM: PlatformId = "x";

/** Notification payload marker that means "open the social draft panel". */
export const SOCIAL_NAV_OPEN = "social";

export type SocialNavTarget = { open: typeof SOCIAL_NAV_OPEN; platform: PlatformId };

export function isSocialPlatform(value: unknown): value is PlatformId {
  return typeof value === "string" && (SOCIAL_NAV_PLATFORMS as readonly string[]).includes(value);
}

/** Valid platform id, otherwise the default (X). Never throws, whatever the payload holds. */
export function resolveSocialPlatform(value: unknown): PlatformId {
  return isSocialPlatform(value) ? value : DEFAULT_SOCIAL_PLATFORM;
}

/**
 * Server side: turn a stored notification payload into the small, safe target the
 * browser needs. Returns null for every notification that does not open the social panel.
 */
export function socialNavTargetFromPayload(payload: Record<string, unknown> | null | undefined): SocialNavTarget | null {
  if (!payload || payload.open !== SOCIAL_NAV_OPEN) return null;
  return { open: SOCIAL_NAV_OPEN, platform: resolveSocialPlatform(payload.platform) };
}

/** Count of drafts a person still has to review: only status "draft" counts. */
export function countDraftsToReview(drafts: readonly { status: string }[] | null | undefined): number {
  if (!drafts) return 0;
  let count = 0;
  for (const draft of drafts) if (draft.status === "draft") count += 1;
  return count;
}

export function formatDraftsToReview(count: number): string {
  if (count <= 0) return "No drafts to review";
  return count === 1 ? "1 draft to review" : `${count} drafts to review`;
}

/** True when any network has at least one draft waiting for review (drives the single badge dot). */
export function hasUnreviewedDrafts(counts: Partial<Record<PlatformId, number>>): boolean {
  return SOCIAL_NAV_PLATFORMS.some((platform) => (counts[platform] ?? 0) > 0);
}
