import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  AUDIT_FUNNEL_EVENTS,
  recordAuditFunnelEvent,
  sanitizeAuditFunnelPayload,
  type AuditFunnelEvent,
  type AuditFunnelPayload,
} from "@/lib/analytics/auditFunnel";
import { guardPublicEvent, readLimitedText, EVENT_MAX_BODY_BYTES } from "@/lib/domain/net/publicGuard";
import { publicRateLimiter } from "@/lib/domain/net/publicRuntime";
import { FEATURES } from "@/lib/features";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // Fail open: an outage of the counter must not drop funnel analytics. The warning is logged.
    const guard = await guardPublicEvent({
      headers: request.headers,
      env: process.env,
      hosted: FEATURES.PLATFORM_MODE,
      limiter: publicRateLimiter("open"),
      readBody: () => readLimitedText(request, EVENT_MAX_BODY_BYTES),
    });
    if (!guard.ok) {
      return NextResponse.json({ error: guard.message }, { status: guard.status, headers: guard.headers });
    }
    const body = guard.body as Partial<AuditFunnelPayload>;
    if (!body.event || !AUDIT_FUNNEL_EVENTS.includes(body.event as AuditFunnelEvent)) {
      return NextResponse.json({ error: "Invalid event." }, { status: 400 });
    }

    const payload = sanitizeAuditFunnelPayload({
      event: body.event as AuditFunnelEvent,
      sessionId: body.sessionId,
      findingCount: body.findingCount,
      criticalCount: body.criticalCount,
      warningCount: body.warningCount,
      failureCode: body.failureCode,
    });

    if (!payload.sessionId) {
      return NextResponse.json({ error: "Invalid session." }, { status: 400 });
    }

    recordAuditFunnelEvent(payload);

    const supabase = await createClient();
    const { error } = await supabase.from("marketing_funnel_events").insert({
      event: payload.event,
      session_id: payload.sessionId,
      finding_count: payload.findingCount ?? null,
      critical_count: payload.criticalCount ?? null,
      warning_count: payload.warningCount ?? null,
      failure_code: payload.failureCode ?? null,
    });

    if (error) {
      // Was previously swallowed into a console.error with `{ ok: true }`
      // still returned -- a failed insert (RLS denial, connection issue,
      // schema mismatch) was indistinguishable from success to any caller
      // or monitoring that only checks the HTTP response. sendBeacon never
      // reads the response either way (fire-and-forget by spec), but the
      // fetch() fallback path -- and any future caller -- can now actually
      // detect this.
      console.error("[audit-funnel] persistence failed", error);
      return NextResponse.json({ ok: false, error: "Persistence failed." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid event payload." }, { status: 400 });
  }
}
