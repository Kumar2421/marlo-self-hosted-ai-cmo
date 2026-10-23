import { NextRequest, NextResponse } from "next/server";
import { outreachContext } from "@/lib/domain/leads/outreachRuntime";
import { handleSend, parseSendRequest } from "@/lib/domain/leads/outreachSend";

/**
 * Sends outreach email through the user's own Gmail. The plan (who may be emailed: stop list, 30-day repeat rule,
 * daily cap, guessed addresses) is recomputed here on the server for every request; the client's plan is never trusted.
 * Fails closed: without the safeguard tables, a signing secret and an app URL nothing is sent.
 */
export async function POST(req: NextRequest) {
  const parsed = parseSendRequest(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const ctx = await outreachContext();
  if (!ctx.ok) return ctx.response;
  const gmail = await ctx.resolveSender();
  if ("error" in gmail) return NextResponse.json({ error: gmail.error }, { status: 422 });

  const { status, body } = await handleSend({ ...ctx.deps, sender: gmail.sender, sendRaw: gmail.sendRaw }, parsed.req);
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
