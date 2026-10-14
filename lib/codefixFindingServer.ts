import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver, type LlmDriver } from "@/lib/llm";
import { PLATFORM_PROVIDER_KEYS } from "@/lib/llm/platformKeys";
import { chargeCredits, getCreditState, InsufficientCreditsError } from "@/lib/credits";
import type { CreditState } from "@/lib/domain/x/draftGuards";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { readGithubAppConfig } from "@/lib/domain/github/githubApp";
import { resolveGithubAccess } from "@/lib/domain/github/githubAppService";
import { githubAppStoreSupabase } from "@/lib/domain/github/githubAppStoreSupabase";
import { resolveCodeFixContext } from "@/lib/domain/codefix/resolveContext";
import type { CodeFixContext } from "@/lib/domain/codefix/types";
import { getProjectFinding } from "@/lib/domain/findings/findingStore";
import { getProjectFinding as getProjectFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import type { Finding } from "@/lib/domain/findings/findingTypes";
import { createAction, listProjectActions, setActionResult } from "@/lib/domain/actions/actionStore";
import {
  createAction as createActionSupabase,
  listProjectActions as listProjectActionsSupabase,
  setActionResult as setActionResultSupabase,
} from "@/lib/domain/actions/actionStoreSupabase";
import { deriveActionType } from "@/lib/domain/actions/deriveActionType";
import { linkPullRequest } from "@/lib/domain/fixes/linkPullRequest";
import { fixDeliveryGithub } from "@/lib/domain/fixes/fixDeliveryGithub";
import { decideFixLink, linkedPrCandidates } from "@/lib/domain/codefix/openPrPolicy";

/**
 * Shared server steps for the finding-based code fix routes (prepare, then apply): who is asking,
 * which repo and short-lived GitHub token to use, the finding itself (from the findings store, in
 * both hosted and self-host mode), the LLM, and recording a fix once its PR exists.
 */

/** usesPlatformKey: the call runs on the operator's key, so the user is metered for it (hosted only). */
export type FixLlm = { driver: LlmDriver; apiKey: string; baseUrl?: string; usesPlatformKey: boolean };

export type FixRequest = {
  userId: string | null;
  projectId: string;
  finding: Finding;
  ctx: CodeFixContext;
  llm: FixLlm | null;
  /** Hosted only: meters the LLM call. Returns an error response when out of credits. */
  charge(model: string): Promise<NextResponse | null>;
  /** Hosted only: the balance read used as a pre-check before the LLM call on the platform key. */
  creditState(): Promise<CreditState>;
  /** PR URLs already tied to this finding (the code_fixes row, then tracked actions), checked before a new PR is opened. */
  linkedPrUrls(): Promise<string[]>;
  /**
   * After the PR exists: remember it (code_fixes) and link it to the finding's tracked action. Idempotent. If a different
   * PR is still open for the finding, that one stays linked. Returns the PR URL the finding is now linked to.
   */
  recordApplied(prUrl: string, files: string[]): Promise<string>;
};

/** Whether a PR is still open on GitHub. Throws only if the lookup itself fails; the caller then records nothing. */
async function isPrOpenOnGithub(token: string, prUrl: string): Promise<boolean> {
  return (await fixDeliveryGithub(token).status(prUrl)).state === "open";
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

function selfHostLlm(providerId: string): FixLlm | NextResponse {
  const driver = getDriver(providerId);
  if (!driver) return fail(`${providerId} isn't wired to a real model yet.`, 501);
  const row = getDb().prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as { api_key: string; base_url: string | null } | undefined;
  if (!row) return fail(`${providerId} isn't connected yet. Connect it in Settings → LLM Providers.`, 422);
  return { driver, apiKey: row.api_key, baseUrl: row.base_url ?? undefined, usesPlatformKey: false };
}

export async function resolveFixRequest(opts: { findingId: string; providerId?: string; needLlm: boolean }): Promise<FixRequest | NextResponse> {
  if (opts.needLlm && !opts.providerId) return fail("No model selected. Connect a provider in Settings → LLM Providers.", 422);

  if (!FEATURES.PLATFORM_MODE) {
    let ctx: CodeFixContext;
    try {
      ctx = resolveCodeFixContext();
    } catch (err) {
      return fail(err instanceof Error ? err.message : "GitHub isn't connected.", 422);
    }
    const finding = getProjectFinding(ctx.projectId, opts.findingId);
    if (!finding) return fail("Finding not found.", 404);
    let llm: FixLlm | null = null;
    if (opts.needLlm) {
      const resolved = selfHostLlm(opts.providerId!);
      if (resolved instanceof NextResponse) return resolved;
      llm = resolved;
    }
    return {
      userId: null,
      projectId: ctx.projectId,
      finding,
      ctx,
      llm,
      charge: async () => null,
      creditState: async () => ({ billingEnabled: false, balance: 0, cost: 0 }),
      linkedPrUrls: async () => {
        const row = getDb().prepare("SELECT pr_url FROM code_fixes WHERE project_id = ? AND issue_id = ?").get(ctx.projectId, finding.id) as { pr_url: string | null } | undefined;
        return linkedPrCandidates(row?.pr_url, listProjectActions(ctx.projectId, finding.id));
      },
      recordApplied: async (prUrl, files) => {
        const now = new Date().toISOString();
        const row = getDb().prepare("SELECT pr_url, file_path FROM code_fixes WHERE project_id = ? AND issue_id = ?").get(ctx.projectId, finding.id) as
          | { pr_url: string | null; file_path: string | null }
          | undefined;
        const { storePrUrl } = await decideFixLink({ existingPrUrl: row?.pr_url, newPrUrl: prUrl, isOpen: (url) => isPrOpenOnGithub(ctx.githubToken, url) });
        if (storePrUrl === prUrl) {
          getDb()
            .prepare(
              `INSERT INTO code_fixes (id, project_id, issue_id, status, pr_url, file_path, created_at, updated_at)
               VALUES (@id, @projectId, @issueId, 'pr_open', @prUrl, @filePath, @now, @now)
               ON CONFLICT(project_id, issue_id) DO UPDATE SET status = 'pr_open', pr_url = excluded.pr_url, file_path = excluded.file_path, updated_at = excluded.updated_at`,
            )
            .run({
              id: `fix_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, projectId: ctx.projectId, issueId: finding.id, prUrl,
              filePath: files.length > 0 ? files.join(", ") : (row?.file_path ?? ""), now,
            });
        }
        for (const link of linkPullRequest(listProjectActions(ctx.projectId, finding.id), storePrUrl)) setActionResult(ctx.projectId, link.id, link.result);
        if (!listProjectActions(ctx.projectId, finding.id).some((a) => (a.result as { pullRequest?: { url?: string } } | null)?.pullRequest?.url === storePrUrl)) {
          const created = createAction({
            projectId: ctx.projectId, findingId: finding.id, type: deriveActionType(finding), title: `Fix in code: ${finding.recommendation.slice(0, 80)}`,
            target: { url: finding.url ?? undefined, repository: ctx.repoFullName }, parameters: { via: "github_pr" },
          });
          setActionResult(ctx.projectId, created.id, { pullRequest: { url: storePrUrl } });
        }
        return storePrUrl;
      },
    };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated", 401);
  const db = createServiceClient();
  const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
  if (!setting?.value) return fail("No active project — add a website first.", 422);
  const { data: project } = await db.from("projects").select("id, name, url").eq("id", setting.value).eq("owner_id", user.id).maybeSingle();
  if (!project) return fail("No active project — add a website first.", 422);

  // GitHub: the App installation first (short-lived token, repo chosen for this project), legacy OAuth token as a fallback.
  let repoFullName = "";
  let githubToken = "";
  const cfg = readGithubAppConfig();
  if (cfg) {
    try {
      const access = await resolveGithubAccess({ cfg, store: githubAppStoreSupabase(db, user.id) }, project.id);
      if (access.status === "ready") {
        repoFullName = access.repoFullName;
        githubToken = access.token;
      } else if (access.status === "no_repo") {
        return fail("Choose which repository Marlo should use in Settings → Integrations.", 422);
      }
    } catch {
      return fail("Couldn't reach GitHub right now. Try again in a moment.", 502);
    }
  }
  if (!githubToken) {
    const { data: conn } = await db.from("provider_connections").select("api_key_secret_id").eq("user_id", user.id).eq("provider_id", "github").maybeSingle();
    const { data: repoSetting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "github_repo").maybeSingle();
    if (conn?.api_key_secret_id && repoSetting?.value) {
      const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
      githubToken = (secret as string) ?? "";
      repoFullName = repoSetting.value;
    }
  }
  if (!githubToken || !repoFullName) return fail("GitHub isn't connected for this project.", 422);

  const finding = await getProjectFindingSupabase(db, user.id, project.id, opts.findingId);
  if (!finding) return fail("Finding not found.", 404);

  let llm: FixLlm | null = null;
  if (opts.needLlm) {
    const providerId = opts.providerId!;
    const driver = getDriver(providerId);
    if (!driver) return fail(`${providerId} isn't wired to a real model yet.`, 501);
    const { data: conn } = await db.from("provider_connections").select("api_key_secret_id, base_url").eq("user_id", user.id).eq("provider_id", providerId).maybeSingle();
    let apiKey = "";
    if (conn?.api_key_secret_id) {
      const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
      apiKey = (secret as string) ?? "";
    }
    let usesPlatformKey = false;
    if (!apiKey) {
      apiKey = PLATFORM_PROVIDER_KEYS[providerId] ?? "";
      usesPlatformKey = apiKey !== "";
    }
    if (!apiKey) return fail(`${providerId} isn't connected yet. Connect it in Settings → LLM Providers.`, 422);
    llm = { driver, apiKey, baseUrl: conn?.base_url ?? undefined, usesPlatformKey };
  }

  const ctx: CodeFixContext = { projectId: project.id, projectName: project.name, projectUrl: project.url, repoFullName, githubToken };
  return {
    userId: user.id,
    projectId: project.id,
    finding,
    ctx,
    llm,
    charge: async (model) => {
      try {
        await chargeCredits(user.id, "code_fix", { projectId: project.id, model });
        return null;
      } catch (err) {
        if (err instanceof InsufficientCreditsError) return fail("Out of credits. Upgrade or connect your own key.", 402);
        throw err;
      }
    },
    creditState: () => getCreditState(user.id, "code_fix"),
    linkedPrUrls: async () => {
      const { data: row } = await db.from("code_fixes").select("pr_url").eq("project_id", project.id).eq("issue_id", finding.id).maybeSingle();
      const actions = await listProjectActionsSupabase(db, user.id, project.id, finding.id);
      return linkedPrCandidates(row?.pr_url, actions);
    },
    recordApplied: async (prUrl, files) => {
      const now = new Date().toISOString();
      const { data: existing } = await db.from("code_fixes").select("created_at, pr_url, file_path").eq("project_id", project.id).eq("issue_id", finding.id).maybeSingle();
      const { storePrUrl } = await decideFixLink({ existingPrUrl: existing?.pr_url, newPrUrl: prUrl, isOpen: (url) => isPrOpenOnGithub(githubToken, url) });
      if (storePrUrl === prUrl) {
        await db.from("code_fixes").upsert(
          {
            user_id: user.id, project_id: project.id, issue_id: finding.id, status: "pr_open", pr_url: prUrl,
            file_path: files.length > 0 ? files.join(", ") : (existing?.file_path ?? ""), created_at: existing?.created_at ?? now, updated_at: now,
          },
          { onConflict: "project_id,issue_id" },
        );
      }
      const actions = await listProjectActionsSupabase(db, user.id, project.id, finding.id);
      for (const link of linkPullRequest(actions, storePrUrl)) await setActionResultSupabase(db, user.id, project.id, link.id, link.result);
      const linked = await listProjectActionsSupabase(db, user.id, project.id, finding.id);
      if (!linked.some((a) => (a.result as { pullRequest?: { url?: string } } | null)?.pullRequest?.url === storePrUrl)) {
        const created = await createActionSupabase(db, user.id, {
          projectId: project.id, findingId: finding.id, type: deriveActionType(finding), title: `Fix in code: ${finding.recommendation.slice(0, 80)}`,
          target: { url: finding.url ?? undefined, repository: repoFullName }, parameters: { via: "github_pr" },
        });
        await setActionResultSupabase(db, user.id, project.id, created.id, { pullRequest: { url: storePrUrl } });
      }
      return storePrUrl;
    },
  };
}
