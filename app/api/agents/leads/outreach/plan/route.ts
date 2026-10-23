import { NextRequest, NextResponse } from "next/server";
import { outreachContext } from "@/lib/domain/leads/outreachRuntime";
import { handlePlan } from "@/lib/domain/leads/outreachSend";

/** Dry run of a send: who would be emailed and who is blocked, and why. Sends nothing. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { leadIds?: unknown; acceptGuessed?: unknown } | null;
  const ctx = await outreachContext();
  if (!ctx.ok) return ctx.response;
  const { status, body: out } = await handlePlan(ctx.deps, body ?? {});
  return NextResponse.json(out, { status, headers: { "Cache-Control": "no-store" } });
}
