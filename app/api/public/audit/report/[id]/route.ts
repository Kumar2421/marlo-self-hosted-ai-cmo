import { NextResponse } from "next/server";
import { isOwnerTokenShape, isReportId } from "@/lib/domain/seo/publicReport";
import { publicReportStore } from "@/lib/domain/seo/publicReportRuntime";
import { guardPublicEvent, readLimitedText, EVENT_MAX_BODY_BYTES } from "@/lib/domain/net/publicGuard";
import { publicRateLimiter } from "@/lib/domain/net/publicRuntime";
import { FEATURES } from "@/lib/features";

export const runtime = "nodejs";

/** Removes a shared report. The owner token (kept in the browser that ran the audit) is the only credential. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await guardPublicEvent({
    headers: request.headers,
    env: process.env,
    hosted: FEATURES.PLATFORM_MODE,
    // Fail closed: removal is a write, so an outage of the counter must not open it up.
    limiter: publicRateLimiter("closed"),
    readBody: () => readLimitedText(request, EVENT_MAX_BODY_BYTES),
  });
  if (!guard.ok) return NextResponse.json({ error: guard.message }, { status: guard.status, headers: guard.headers });

  const { id } = await ctx.params;
  const token = request.headers.get("x-report-token");
  // The same answer for a wrong id and a wrong token, so ids cannot be probed.
  if (!isReportId(id) || !isOwnerTokenShape(token)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const removed = await publicReportStore().remove(id, token);
    if (!removed) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[public-audit] report remove failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Could not remove the report." }, { status: 500 });
  }
}
