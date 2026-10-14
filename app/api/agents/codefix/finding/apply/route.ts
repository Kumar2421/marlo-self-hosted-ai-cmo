import { NextRequest, NextResponse } from "next/server";
import { resolveFixRequest } from "@/lib/codefixFindingServer";
import { ticketClaimsFor, ticketSecret } from "@/lib/githubAppServer";
import { getCodeFixProvider } from "@/lib/domain/codefix/getCodeFixProvider";
import { redeemTicket } from "@/lib/domain/codefix/ticket";
import { recordOpenedPr } from "@/lib/domain/codefix/recordOpenedPr";
import { openOrReuseFixPr, type OpenFixOutcome } from "@/lib/domain/codefix/openFixPr";
import { branchPrefixFor } from "@/lib/domain/codefix/openPrPolicy";
import { listOpenPullRequests } from "@/lib/domain/codefix/githubApi";
import { fixDeliveryGithub } from "@/lib/domain/fixes/fixDeliveryGithub";

export const maxDuration = 60;

/**
 * Approval step: the user reviewed the preview and pressed "Approve and open PR". The ticket is
 * single use and bound to a hash of the exact changes, so only what was previewed is written (an
 * edited preview goes through /finding/revise first). Opens a pull request; it never merges. No LLM
 * call here, so no credit charge.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const findingId = typeof body?.findingId === "string" ? body.findingId : "";
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });

  const resolved = await resolveFixRequest({ findingId, needLlm: false });
  if (resolved instanceof NextResponse) return resolved;

  let redeemed: Awaited<ReturnType<typeof redeemTicket>>;
  try {
    redeemed = await redeemTicket(
      ticketSecret(),
      body?.ticket,
      { userId: resolved.userId, projectId: resolved.projectId, findingId: resolved.finding.id },
      body?.changes,
      ticketClaimsFor(resolved.userId),
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't check the preview." }, { status: 500 });
  }
  if (!redeemed.ok) return NextResponse.json({ error: redeemed.error }, { status: redeemed.status });

  const label = redeemed.label ?? resolved.finding.recommendation.slice(0, 80);
  let outcome: OpenFixOutcome;
  try {
    const explanation = typeof body?.explanation === "string" && body.explanation.trim() ? body.explanation.trim().slice(0, 1000) : "Fixes the reported issue.";
    // The provider's LLM is not used when applying; any driver works as a placeholder.
    const provider = getCodeFixProvider("contents-api", async () => ({ text: "" }) as never, "", "");
    const { githubToken, repoFullName } = resolved.ctx;
    outcome = await openOrReuseFixPr(
      {
        linkedPrUrls: () => resolved.linkedPrUrls(),
        prStatus: (prUrl) => fixDeliveryGithub(githubToken).status(prUrl),
        listOpenPullRequests: () => listOpenPullRequests(githubToken, repoFullName),
        openPr: () =>
          provider.applyCatalogFix(redeemed.changes, resolved.ctx, {
            findingId: resolved.finding.id,
            label,
            recommendation: resolved.finding.recommendation,
            pageUrl: resolved.finding.url,
            explanation,
            kinds: redeemed.kinds,
          }),
      },
      { branchPrefix: branchPrefixFor(label) },
    );
  } catch (err) {
    // Nothing was opened: let the user retry the same preview.
    await redeemed.release().catch(() => undefined);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't open the pull request." }, { status: 500 });
  }

  const opened = outcome.kind === "opened" ? outcome : { prUrl: outcome.prUrl, branch: outcome.branch, files: [] };
  // A PR exists on GitHub (opened now, or already open for this finding). The ticket stays consumed
  // (releasing it would allow a second PR), and a bookkeeping failure must not hide the PR from the user.
  const result = await recordOpenedPr(opened, (prUrl, files) => resolved.recordApplied(prUrl, files), (err) =>
    console.error("codefix apply: PR opened but recording it failed", { prUrl: opened.prUrl, error: err instanceof Error ? err.message : String(err) }),
  );
  return NextResponse.json(outcome.kind === "existing" ? { ...result, alreadyOpen: true } : result);
}
