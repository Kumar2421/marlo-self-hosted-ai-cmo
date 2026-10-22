import { NextRequest, NextResponse } from "next/server";
import { hostedContext, isHostedContext, SETTINGS_PATH } from "@/lib/githubAppServer";
import { handleInstallCallback } from "@/lib/domain/github/githubAppService";
import { verifyInstallState } from "@/lib/domain/github/githubApp";
import { returnUrl } from "@/lib/domain/github/returnPath";

/**
 * GitHub sends the user back here: after user authorization (code only, used to find an existing
 * installation), after a fresh install, and after an update (installation_id + code). Set it as
 * both the Callback URL and the Setup URL (with "Redirect on update" on).
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const params = req.nextUrl.searchParams;
  const ctx = await hostedContext();
  // Failures go back to where the user started (the finding they were fixing), when the signed state says so.
  const pending = isHostedContext(ctx) ? verifyInstallState(ctx.cfg, params.get("state")) : null;
  const fail = (message: string, returnTo: string | null = pending?.returnTo ?? null) => NextResponse.redirect(returnUrl(origin, returnTo ?? SETTINGS_PATH, { github_error: message }));
  if (!isHostedContext(ctx)) {
    const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
    return fail(body?.error ?? "Couldn't finish the GitHub connection.");
  }
  if (params.get("setup_action") === "request") return fail("The GitHub organization owner still has to approve the installation.");
  if (params.get("error")) return fail("GitHub authorization was cancelled. Please try connecting again.");
  try {
    const out = await handleInstallCallback(ctx.deps, {
      userId: ctx.userId,
      state: params.get("state"),
      installationId: params.get("installation_id"),
      code: params.get("code"),
      callbackUrl: `${origin}/api/github/app/callback`,
    });
    if (out.kind === "redirect") return NextResponse.redirect(out.url);
    if (out.kind === "error") return fail(out.error, out.returnTo);
    return NextResponse.redirect(returnUrl(origin, out.returnTo ?? SETTINGS_PATH, { github: "connected" }));
  } catch {
    return fail("Couldn't finish the GitHub connection. Please try again.");
  }
}
