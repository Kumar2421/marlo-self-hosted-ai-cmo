import { NextResponse } from "next/server";
import { maybeRunSelfHostJob, notificationContext } from "@/lib/domain/notifications/serverContext";
import { socialNavTargetFromPayload } from "@/lib/domain/social/socialNav";

/** The signed-in user's notifications (newest first) and how many are unread. */
export async function GET() {
  const ctx = await notificationContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    maybeRunSelfHostJob();
    const [notifications, unreadCount] = await Promise.all([ctx.store.list(ctx.userId, { limit: 50 }), ctx.store.unreadCount(ctx.userId)]);
    // Never expose delivery internals (email error text) to the browser.
    return NextResponse.json({
      unreadCount,
      notifications: notifications.map((n) => ({
        id: n.id, kind: n.kind, projectId: n.projectId, title: n.title, body: n.body, createdAt: n.createdAt, read: n.readAt !== null,
        // Only the safe click-through target leaves the server, never the raw payload.
        nav: socialNavTargetFromPayload(n.payload),
      })),
    });
  } catch {
    return NextResponse.json({ error: "Could not load notifications." }, { status: 500 });
  }
}
