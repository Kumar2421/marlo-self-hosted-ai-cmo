import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { listReplies, type GmailReply } from "@/lib/domain/leads/gmailInbox";
import { outreachStoreForDeployment } from "@/lib/domain/leads/outreachRuntime";
import { recordReplyStops } from "@/lib/domain/leads/outreachUnsubscribe";
import { plainTextFromGmailPayload } from "@/lib/domain/leads/replyStop";
import { LOCAL_USER_ID } from "@/lib/domain/notifications/notificationStore";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import type { SupabaseClient } from "@supabase/supabase-js";

const CHECK_CONCURRENCY = 3;

/** Platform-mode Gmail token resolution — mirrors gmailOAuth.ts's
 * getValidGmailAccessToken() but reads/writes integration_connections +
 * Vault instead of local SQLite settings. Duplicated (not extracted to a
 * shared lib) because gmailOAuth.ts / gmailInbox.ts / gmailSend.ts belong to
 * a parallel migration cluster and are out of scope here. */
async function getValidGmailAccessTokenSupabase(db: SupabaseClient, userId: string): Promise<string> {
  const { data: conn } = await db
    .from("integration_connections")
    .select("access_token_secret_id, refresh_token_secret_id, token_expiry")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .maybeSingle();

  if (!conn?.access_token_secret_id) {
    throw new Error("Gmail isn't connected — use Connect Gmail at the top of the Leads panel.");
  }

  const expiresAt = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;
  if (Date.now() < expiresAt - 60_000) {
    const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.access_token_secret_id });
    if (secret) return secret as string;
  }

  if (!conn.refresh_token_secret_id) {
    throw new Error("Gmail isn't connected — use Connect Gmail at the top of the Leads panel.");
  }
  const { data: refreshSecret } = await db.rpc("vault_get_secret", { p_id: conn.refresh_token_secret_id });
  const refreshToken = refreshSecret as string;
  if (!refreshToken) throw new Error("Gmail isn't connected — use Connect Gmail at the top of the Leads panel.");

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET not set.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: HTTP ${res.status}`);
  const data = await res.json();
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  const { data: newSecretId } = await db.rpc("vault_set_secret", {
    p_secret: data.access_token,
    p_name: `gmail_access_token:${userId}:${Date.now()}`,
  });
  await db
    .from("integration_connections")
    .update({ access_token_secret_id: newSecretId as string, token_expiry: newExpiresAt })
    .eq("user_id", userId)
    .eq("provider", "gmail");

  return data.access_token as string;
}

/** Platform-mode inline copy of gmailInbox.ts's listReplies(), parameterized
 * on an access token instead of calling getValidGmailAccessToken() itself
 * (that helper is SQLite-only and out of scope for this route). */
async function listRepliesSupabase(accessToken: string, threadId: string, ourMessageId: string): Promise<GmailReply[]> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Gmail rejected this — reconnect Gmail and allow reading replies to enable reply tracking.");
    }
    const detail = await res.text().catch(() => "");
    throw new Error(`Gmail thread read failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  const messages: { id: string; snippet: string; payload?: { headers?: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: unknown[] } }[] = data.messages ?? [];
  return messages
    .filter((m) => m.id !== ourMessageId)
    .map((m) => ({
      snippet: m.snippet ?? "",
      from: m.payload?.headers?.find((h) => h.name.toLowerCase() === "from")?.value ?? "",
      internalDate: m.payload?.headers?.find((h) => h.name.toLowerCase() === "date")?.value ?? "",
      text: plainTextFromGmailPayload(m.payload as Parameters<typeof plainTextFromGmailPayload>[0]),
    }));
}

/** Real, on-demand poll — no background worker in this app, so this only
 * runs when the user explicitly clicks "Check replies". Loops every sent
 * lead with a real Gmail thread, reads the thread for real, and updates
 * last_reply_at/last_reply_snippet only when the reply is newer than what's
 * already stored (idempotent — safe to click repeatedly). */
export async function POST() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const activeId = setting?.value ?? null;
    if (!activeId) return NextResponse.json({ error: "No active project." }, { status: 422 });

    const { data: leads, error } = await db
      .from("leads")
      .select("id, email, gmail_thread_id, gmail_message_id, last_reply_snippet")
      .eq("user_id", user.id)
      .eq("project_id", activeId)
      .eq("email_status", "sent")
      .not("gmail_thread_id", "is", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (!leads || leads.length === 0) {
      return NextResponse.json({ checked: 0, newReplies: 0 });
    }

    // No credit charge — polling Gmail is not a metered agent action.
    let newReplies = 0;
    let lastError: string | null = null;

    try {
      const accessToken = await getValidGmailAccessTokenSupabase(db, user.id);

      for (let i = 0; i < leads.length; i += CHECK_CONCURRENCY) {
        const batch = leads.slice(i, i + CHECK_CONCURRENCY);
        await Promise.all(
          batch.map(async (lead) => {
            try {
              const replies = await listRepliesSupabase(accessToken, lead.gmail_thread_id, lead.gmail_message_id);
              if (replies.length === 0) return;
              await recordReplyStops(outreachStoreForDeployment(), user.id, lead.email, replies.map((r) => r.text || r.snippet)).catch(() => false);
              const latest = replies[replies.length - 1];
              if (latest.snippet && latest.snippet !== lead.last_reply_snippet) {
                await db
                  .from("leads")
                  .update({
                    last_reply_at: latest.internalDate ? new Date(latest.internalDate).toISOString() : new Date().toISOString(),
                    last_reply_snippet: latest.snippet,
                  })
                  .eq("user_id", user.id)
                  .eq("id", lead.id);
                newReplies++;
              }
            } catch (err) {
              lastError = err instanceof Error ? err.message : String(err);
            }
          })
        );
      }
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Gmail isn't connected." }, { status: 422 });
    }

    return NextResponse.json({ checked: leads.length, newReplies, error: lastError });
  }

  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ error: "No active project." }, { status: 422 });

  const db = getDb();
  const leads = db
    .prepare(
      `SELECT id, email, gmail_thread_id, gmail_message_id, last_reply_snippet FROM leads
       WHERE project_id = ? AND email_status = 'sent' AND gmail_thread_id IS NOT NULL`
    )
    .all(activeId) as { id: string; email: string | null; gmail_thread_id: string; gmail_message_id: string; last_reply_snippet: string | null }[];

  if (leads.length === 0) {
    return NextResponse.json({ checked: 0, newReplies: 0 });
  }

  const update = db.prepare("UPDATE leads SET last_reply_at = ?, last_reply_snippet = ? WHERE id = ?");
  let newReplies = 0;
  let lastError: string | null = null;

  for (let i = 0; i < leads.length; i += CHECK_CONCURRENCY) {
    const batch = leads.slice(i, i + CHECK_CONCURRENCY);
    await Promise.all(
      batch.map(async (lead) => {
        try {
          const replies = await listReplies(lead.gmail_thread_id, lead.gmail_message_id);
          if (replies.length === 0) return;
          await recordReplyStops(outreachStoreForDeployment(), LOCAL_USER_ID, lead.email, replies.map((r) => r.text || r.snippet)).catch(() => false);
          const latest = replies[replies.length - 1];
          // internalDate here is the real RFC 2822 Date header string — string
          // compare is enough to detect "changed since last check", exact
          // chronological sort isn't needed for a single latest-reply snippet.
          if (latest.snippet && latest.snippet !== lead.last_reply_snippet) {
            update.run(latest.internalDate || new Date().toISOString(), latest.snippet, lead.id);
            newReplies++;
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      })
    );
  }

  return NextResponse.json({ checked: leads.length, newReplies, error: lastError });
}
