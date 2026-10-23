import { NextRequest, NextResponse } from "next/server";
import { assistantHealthResponse } from "@/lib/domain/assistant/healthEndpoint";
import { getAssistantTelemetry } from "@/lib/domain/assistant/turnLog";

export const dynamic = "force-dynamic";

/** Admin-only (CRON_SECRET bearer). Returns per-instance assistant counters; no message content. */
export async function GET(req: NextRequest) {
  const r = assistantHealthResponse(req.headers.get("authorization"), process.env.CRON_SECRET, getAssistantTelemetry().metrics);
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
