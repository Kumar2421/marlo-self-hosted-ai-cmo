import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { readGithubAppConfig } from "@/lib/domain/github/githubApp";
import { listSelectableRepos } from "@/lib/domain/github/githubAppService";
import { hostedContext, isHostedContext } from "@/lib/githubAppServer";

export type GithubStatus = {
  /** "app": hosted GitHub App. "pat": self-host personal access token (unchanged). */
  mode: "app" | "pat";
  /** The hosted deployment has the GitHub App credentials. */
  configured: boolean;
  connected: boolean;
  repoFullName: string | null;
  /** Installed, but no repository chosen yet. */
  needsRepo?: boolean;
  repos?: { fullName: string; private: boolean }[];
  slug?: string;
  /**
   * Set when the answer is not a plain "connected" or "not connected":
   * "access_removed": GitHub no longer shares anything with Marlo, so the link was cleared (connected is false).
   * "repos_unavailable": GitHub could not be asked for the repository list; `connected` still reflects Marlo's own link.
   */
  error?: "access_removed" | "repos_unavailable";
};

/** What the UI needs to decide between "Connect GitHub" and "Prepare fix". Pass ?repos=1 for the picker list. */
export async function GET(req: NextRequest) {
  if (!FEATURES.PLATFORM_MODE) {
    const projectId = getActiveProjectId();
    const rows = projectId
      ? (getDb().prepare("SELECT key, value FROM settings WHERE key IN ('github_pat', 'github_repo')").all() as { key: string; value: string }[])
      : [];
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const status: GithubStatus = { mode: "pat", configured: true, connected: Boolean(map.github_pat && map.github_repo), repoFullName: map.github_repo || null };
    return NextResponse.json(status);
  }

  if (!readGithubAppConfig()) return NextResponse.json({ mode: "app", configured: false, connected: false, repoFullName: null } satisfies GithubStatus);
  const ctx = await hostedContext();
  if (!isHostedContext(ctx)) return ctx;
  const link = await ctx.deps.store.get(ctx.projectId);
  const base: GithubStatus = {
    mode: "app",
    configured: true,
    connected: Boolean(link?.repoFullName),
    needsRepo: Boolean(link && !link.repoFullName),
    repoFullName: link?.repoFullName ?? null,
    slug: ctx.cfg.slug,
  };
  if (!link || req.nextUrl.searchParams.get("repos") !== "1") return NextResponse.json(base);
  try {
    const listed = await listSelectableRepos(ctx.deps, ctx.projectId);
    if (!listed.ok) return NextResponse.json({ ...base, connected: false, needsRepo: false, repoFullName: null, error: "access_removed" } satisfies GithubStatus);
    return NextResponse.json({ ...base, repos: listed.repos.map((r) => ({ fullName: r.fullName, private: r.private })) });
  } catch {
    return NextResponse.json({ ...base, repos: [], error: "repos_unavailable" } satisfies GithubStatus);
  }
}
