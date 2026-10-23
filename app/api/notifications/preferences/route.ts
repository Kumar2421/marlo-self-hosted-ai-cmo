import { NextRequest, NextResponse } from "next/server";
import { normalizePrefs } from "@/lib/domain/notifications/preferences";
import { emailReady, notificationConfig } from "@/lib/domain/notifications/runtime";
import { notificationContext } from "@/lib/domain/notifications/serverContext";

async function respond(ctx: NonNullable<Awaited<ReturnType<typeof notificationContext>>>) {
  const { prefs, unsubscribedAll } = await ctx.store.getPreferences(ctx.userId);
  const config = notificationConfig();
  return NextResponse.json({
    prefs,
    unsubscribedAll,
    // Whether the server can send email at all, and where it would go (for the "send me a test" button).
    // True only when emails can really be sent: a provider key and sender, plus the signing
    // secret and app URL the job needs for the unsubscribe links (without them it sends nothing).
    emailConfigured: emailReady(config),
    email: ctx.email,
  });
}

export async function GET() {
  const ctx = await notificationContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    return await respond(ctx);
  } catch {
    return NextResponse.json({ error: "Could not load preferences." }, { status: 500 });
  }
}

/** Save `{ prefs }` (validated, bad values fall back to defaults) and/or `{ unsubscribedAll }` (to turn email back on). */
export async function PUT(req: NextRequest) {
  const ctx = await notificationContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { prefs?: unknown; unsubscribedAll?: unknown } | null;
  if (!body || (body.prefs === undefined && typeof body.unsubscribedAll !== "boolean")) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }
  try {
    if (body.prefs !== undefined) await ctx.store.savePreferences(ctx.userId, normalizePrefs(body.prefs));
    if (typeof body.unsubscribedAll === "boolean") await ctx.store.setUnsubscribedAll(ctx.userId, body.unsubscribedAll);
    return await respond(ctx);
  } catch {
    return NextResponse.json({ error: "Could not save preferences." }, { status: 500 });
  }
}
