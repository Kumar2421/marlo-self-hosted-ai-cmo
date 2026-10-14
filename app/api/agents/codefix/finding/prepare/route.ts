import { NextRequest, NextResponse } from "next/server";
import { resolveFixRequest } from "@/lib/codefixFindingServer";
import { ticketSecret } from "@/lib/githubAppServer";
import { classifyFinding } from "@/lib/domain/codefix/fixCatalog";
import { getCodeFixProvider } from "@/lib/domain/codefix/getCodeFixProvider";
import { prepareCatalogFix } from "@/lib/domain/codefix/prepareCatalogFix";
import { issueTicket } from "@/lib/domain/codefix/ticket";

// LLM + GitHub reads can run past the default timeout.
export const maxDuration = 60;

/**
 * Preview step. Reads the repo and drafts the change, but never writes: no branch, no commit, no
 * PR. Manual findings get an explanation instead of a draft (and cost no credits). The returned
 * `ticket` binds the proposal (user, project, finding, and a hash of the exact changes) for the apply step; single use.
 *
 * Credits: on the platform key the balance is checked before the LLM runs and charged only after a
 * proposal exists (see lib/domain/codefix/prepareCatalogFix.ts for the ordering).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const findingId = typeof body?.findingId === "string" ? body.findingId : "";
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });
  const model = typeof body?.model === "string" ? body.model : "";
  const providerId = typeof body?.providerId === "string" ? body.providerId : "";

  const classification = await (async () => {
    const early = await resolveFixRequest({ findingId, providerId, needLlm: false });
    return early instanceof NextResponse ? early : { early, classification: classifyFinding(early.finding) };
  })();
  if (classification instanceof NextResponse) return classification;
  const { early, classification: verdict } = classification;

  if (verdict.mode === "manual") {
    return NextResponse.json({ mode: "manual", reason: verdict.reason, recommendation: early.finding.recommendation });
  }
  if (!model || !providerId) return NextResponse.json({ error: "No model selected. Connect a provider in Settings → LLM Providers." }, { status: 422 });

  const resolved = await resolveFixRequest({ findingId, providerId, needLlm: true });
  if (resolved instanceof NextResponse) return resolved;
  const llm = resolved.llm;
  if (!llm) return NextResponse.json({ error: "No model available." }, { status: 422 });

  try {
    const secret = ticketSecret(); // fail closed before any LLM call
    const provider = getCodeFixProvider("contents-api", llm.driver, llm.apiKey, model, llm.baseUrl);
    const outcome = await prepareCatalogFix({
      isByok: !llm.usesPlatformKey,
      creditState: () => resolved.creditState(),
      propose: () =>
        provider.proposeCatalogFix(
          {
            findingId: resolved.finding.id,
            label: verdict.label,
            kinds: verdict.kinds,
            recommendation: resolved.finding.recommendation,
            evidence: resolved.finding.evidence,
            pageUrl: resolved.finding.url,
          },
          resolved.ctx,
        ),
      charge: async () => (await resolved.charge(model)) === null,
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    const proposal = outcome.proposal;
    const ticket = issueTicket(
      secret,
      { userId: resolved.userId, projectId: resolved.projectId, findingId: resolved.finding.id },
      { changes: proposal.changes, kinds: verdict.kinds, label: verdict.label },
    );
    return NextResponse.json({
      mode: "auto",
      label: verdict.label,
      repoFullName: resolved.ctx.repoFullName,
      explanation: proposal.explanation,
      changes: proposal.changes,
      ticket,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't prepare a fix." }, { status: 500 });
  }
}
