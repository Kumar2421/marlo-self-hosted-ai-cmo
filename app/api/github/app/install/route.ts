import { NextRequest, NextResponse } from "next/server";
import { hostedContext, isHostedContext, SETTINGS_PATH } from "@/lib/githubAppServer";
import { returnUrl, safeReturnPath } from "@/lib/domain/github/returnPath";
import { startInstall } from "@/lib/domain/github/githubAppService";

/** Starts the GitHub App installation: a signed state bound to this user and project, then GitHub. */
export async function GET(req: NextRequest) {
  const returnTo = safeReturnPath(req.nextUrl.searchParams.get("returnTo"));
  const back = (message: string) => NextResponse.redirect(returnUrl(req.nextUrl.origin, returnTo ?? SETTINGS_PATH, { github_error: message }));
  const ctx = await hostedContext();
  if (!isHostedContext(ctx)) {
    const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
    return back(body?.error ?? "Couldn't start the GitHub connection.");
  }
  const started = startInstall(ctx.cfg, { userId: ctx.userId, projectId: ctx.projectId, returnTo });
  return started.ok ? NextResponse.redirect(started.url) : back(started.error);
}
