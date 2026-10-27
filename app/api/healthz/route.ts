import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe for containers and uptime checks. No data, no auth, no database access. */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
