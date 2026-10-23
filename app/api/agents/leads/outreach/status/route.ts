import { NextResponse } from "next/server";
import { outreachContext } from "@/lib/domain/leads/outreachRuntime";
import { handleStatus } from "@/lib/domain/leads/outreachSend";

/** How much of today's send allowance is left. 503 until the outreach tables exist. */
export async function GET() {
  const ctx = await outreachContext();
  if (!ctx.ok) return ctx.response;
  const { status, body } = await handleStatus(ctx.deps);
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
