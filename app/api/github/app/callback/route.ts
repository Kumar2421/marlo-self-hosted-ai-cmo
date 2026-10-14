import { NextRequest, NextResponse } from "next/server";
import { hostedContext, isHostedContext, SETTINGS_PATH } from "@/lib/githubAppServer";
import { completeInstall } from "@/lib/domain/github/githubAppService";
import { verifyInstallState } from "@/lib/domain/github/githubApp";
import { returnUrl } from "@/lib/domain/github/returnPath";

/** GitHub sends the user back here after installing (set this as both the Callback URL and the Setup URL). */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const params = req.nextUrl.searchParams;
  const ctx = await hostedContext();
  // Failures go back to where the user started (the finding they were fixing), when the signed state says so.
  const pending = isHostedContext(ctx) ? verifyInstallState(ctx.cfg, params.get("state")) : null;
  const fail = (message: string) => NextResponse.redirect(returnUrl(origin, pending?.returnTo ?? SETTINGS_PATH, { github_error: message }));
  if (!isHostedContext(ctx)) {
    const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
    return fail(body?.error ?? "Couldn't finish the GitHub connection.");
  }
  if (params.get("setup_action") === "request") return fail("The GitHub organization owner still has to approve the installation.");
  try {
    const result = await completeInstall(ctx.deps, {
      userId: ctx.userId,
      state: params.get("state"),
      installationId: params.get("installation_id"),
      code: params.get("code"),
    });
    if (!result.ok) return fail(result.error);
    const target = returnUrl(origin, result.returnTo ?? SETTINGS_PATH, { github: "connected" });
    return NextResponse.redirect(target);
  } catch {
    return fail("Couldn't finish the GitHub connection. Please try again.");
  }
}
