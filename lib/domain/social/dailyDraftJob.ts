import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithBudget } from "../../jobs/jobRunner.ts";
import { getCreditState } from "../../credits.ts";
import { getProjectContextSupabaseById } from "../shared/getActiveProjectSupabase.ts";
import { buildDraftPrompt } from "../x/draftPost.ts";
import type { NotificationStore } from "../notifications/ports.ts";
import { canAffordCredits } from "./draftGeneration.ts";
import {
  SKIP_REASONS, SOCIAL_PLATFORMS, isoDay, notifySocialDrafts, rotationOrder, runDailyDrafts,
  type DailyDraftPorts, type DailyDraftSummary, type ProjectTarget, type SkipReason,
} from "./dailyDrafts.ts";
import {
  claimSocialDay, isSocialPlatformDone, loadSocialMarkers, markSocialPlatformDone, pendingDraftCount,
  releaseSocialDay, socialProductInfoProjects,
} from "./dailyDraftsStoreSupabase.ts";
import { defaultSubredditFor, draftLimitFor, generateForPlatform, resolvePlatformModelAccess, type DraftScope } from "./draftPorts.ts";
import { linkedInPrompt, redditPrompt } from "./platformPrompts.ts";
import type { PlatformId } from "./platforms.ts";

/** The daily drafts ports for one project (platform mode). */
export function platformDailyDraftPorts(db: SupabaseClient, userId: string, projectId: string, now: Date): DailyDraftPorts {
  const scope: DraftScope = { mode: "platform", db, userId, projectId };
  return {
    claimDay: (day) => claimSocialDay(db, userId, projectId, day, now),
    releaseDay: (day) => releaseSocialDay(db, userId, projectId, day),
    isDone: (platform, day) => isSocialPlatformDone(db, projectId, day, platform),
    markDone: (platform, day) => markSocialPlatformDone(db, userId, projectId, day, platform, new Date()),
    snapshot: async () => {
      const project = await getProjectContextSupabaseById(db, userId, projectId);
      const access = await resolvePlatformModelAccess(db, userId);
      const subreddit = (await defaultSubredditFor(scope)) || null;
      const credits = access.usesPlatformKey ? await getCreditState(userId, "social_draft") : null;
      return {
        hasProductInfo: Boolean(project?.productInfo?.trim()),
        subreddit,
        modelAccess: !access.apiKey ? "none" : access.usesPlatformKey ? "platform" : "byok",
        creditsAffordable: credits ? canAffordCredits(credits) : true,
      };
    },
    pendingCount: (platform) => pendingDraftCount(db, userId, projectId, platform),
    generate: async (platform: PlatformId) => {
      const project = await getProjectContextSupabaseById(db, userId, projectId);
      if (!project) throw new Error("Project not found.");
      const access = await resolvePlatformModelAccess(db, userId);
      const limit = await draftLimitFor(scope, access);
      const productInfo = project.productInfo;
      let prompt: { system: string; prompt: string };
      if (platform === "x") {
        prompt = buildDraftPrompt({
          name: project.name,
          description: project.description,
          category: project.category,
          productInfo,
          marketingStrategy: project.marketingStrategy,
          variants: 1,
        });
      } else if (platform === "linkedin") {
        prompt = linkedInPrompt(project, 1, { productInfo });
      } else {
        const subreddit = await defaultSubredditFor(scope);
        prompt = redditPrompt(project, subreddit, 1, { productInfo });
      }
      return generateForPlatform(platform, scope, { access, limit, variants: 1, system: prompt.system, prompt: prompt.prompt });
    },
  };
}

export type SocialDailyJobSummary = {
  /** Projects with a product info document that still had a network to run today. */
  due: number;
  processed: number;
  /** Projects left for the next run because the budget ran out first. */
  budgetSkipped: number;
  busy: number;
  interrupted: number;
  created: Record<PlatformId, number>;
  skipped: Record<SkipReason, number>;
  /** Fixed messages only, per project and network. */
  errors: Array<{ projectId: string; platform: PlatformId; error: string }>;
  failed: number;
  notified: number;
  notifyFailed: number;
};

/**
 * The daily social drafts pass: one project at a time, fairly rotated, within a
 * time budget. Failures are isolated per project and never throw. At most one
 * in-app item per user per day, and only when drafts were created.
 */
export async function runSocialDailyJob(
  db: SupabaseClient,
  store: Pick<NotificationStore, "getPreferences" | "record">,
  opts: { now: Date; budgetMs: number },
): Promise<SocialDailyJobSummary> {
  const { now, budgetMs } = opts;
  const day = isoDay(now);
  const deadline = Date.now() + budgetMs;
  const timeUp = () => Date.now() >= deadline;

  const [targets, markers] = await Promise.all([socialProductInfoProjects(db), loadSocialMarkers(db, now)]);
  const pending: ProjectTarget[] = targets.filter((t) => (markers.doneToday.get(t.projectId)?.size ?? 0) < SOCIAL_PLATFORMS.length);
  const ordered = rotationOrder(pending, markers.lastDone);

  const summary: SocialDailyJobSummary = {
    due: ordered.length, processed: 0, budgetSkipped: 0, busy: 0, interrupted: 0,
    created: { x: 0, linkedin: 0, reddit: 0 },
    skipped: Object.fromEntries(SKIP_REASONS.map((r) => [r, 0])) as Record<SkipReason, number>,
    errors: [], failed: 0, notified: 0, notifyFailed: 0,
  };
  // One in-app item per user: the first project that got drafts names the item; counts add up across projects.
  const perUser = new Map<string, { projectId: string; created: Record<PlatformId, number> }>();

  const run = await runWithBudget(
    ordered,
    async (t) => {
      let result: DailyDraftSummary;
      try {
        result = await runDailyDrafts(platformDailyDraftPorts(db, t.userId, t.projectId, now), now, { timeUp });
      } catch {
        summary.failed += 1;
        return;
      }
      if (result.busy) summary.busy += 1;
      if (result.interrupted) summary.interrupted += 1;
      for (const p of SOCIAL_PLATFORMS) summary.created[p] += result.created[p];
      for (const s of result.skipped) summary.skipped[s.reason] += 1;
      for (const e of result.errors) summary.errors.push({ projectId: t.projectId, platform: e.platform, error: e.error });

      const total = SOCIAL_PLATFORMS.reduce((n, p) => n + result.created[p], 0);
      if (total > 0) {
        const entry = perUser.get(t.userId) ?? { projectId: t.projectId, created: { x: 0, linkedin: 0, reddit: 0 } };
        for (const p of SOCIAL_PLATFORMS) entry.created[p] += result.created[p];
        perUser.set(t.userId, entry);
      }
    },
    { budgetMs },
  );
  summary.processed = run.processed;
  summary.budgetSkipped = run.skipped;

  for (const [userId, entry] of perUser) {
    try {
      const { notified } = await notifySocialDrafts(store, userId, { projectId: entry.projectId, day, created: entry.created }, now);
      if (notified) summary.notified += 1;
    } catch {
      summary.notifyFailed += 1;
    }
  }
  return summary;
}
