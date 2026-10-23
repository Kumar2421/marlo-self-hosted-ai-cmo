import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { getCreditState, spendCredits } from "@/lib/credits";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { appUrlFrom } from "@/lib/domain/notifications/runtime";
import { LOCAL_USER_ID } from "@/lib/domain/notifications/notificationStore";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { postGmailRaw, sendGmailRaw } from "./gmailSend";
import type { OutreachDeps, OutreachLeadRow } from "./outreachSend";
import type { OutreachStore } from "./outreachStore";
import { sqliteOutreachStore } from "./outreachStoreSqlite";
import { supabaseOutreachStore } from "./outreachStoreSupabase";

/** Store for the current deployment mode: Supabase service client when hosted, SQLite on self-host. */
export function outreachStoreForDeployment(): OutreachStore {
  return FEATURES.PLATFORM_MODE ? supabaseOutreachStore(createServiceClient()) : sqliteOutreachStore(getDb());
}

/** Gmail access token in platform mode (Vault + refresh). Throws a user-facing message when Gmail is not connected. */
export async function getValidGmailAccessTokenSupabase(db: SupabaseClient, userId: string): Promise<string> {
  const notConnected = "Gmail isn't connected — use Connect Gmail at the top of the Leads panel.";
  const { data: conn } = await db
    .from("integration_connections")
    .select("access_token_secret_id, refresh_token_secret_id, token_expiry")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .maybeSingle();
  if (!conn?.access_token_secret_id) throw new Error(notConnected);

  const expiresAt = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;
  if (Date.now() < expiresAt - 60_000) {
    const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.access_token_secret_id });
    if (secret) return secret as string;
  }

  if (!conn.refresh_token_secret_id) throw new Error(notConnected);
  const { data: refreshSecret } = await db.rpc("vault_get_secret", { p_id: conn.refresh_token_secret_id });
  const refreshToken = refreshSecret as string;
  if (!refreshToken) throw new Error(notConnected);

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET not set.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
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

const LEAD_COLUMNS = "id, name, company, title, email, email_verified, email_quality";

type LeadDbRow = {
  id: string; name: string | null; company: string | null; title: string | null; email: string | null;
  email_verified: boolean | number | null; email_quality: string | null;
};
const toRow = (r: LeadDbRow): OutreachLeadRow => ({
  id: String(r.id), name: r.name, company: r.company, title: r.title, email: r.email,
  emailVerified: r.email_verified, emailQuality: r.email_quality,
});

export type OutreachContext =
  | { ok: true; deps: Omit<OutreachDeps, "sender" | "sendRaw">; userId: string; projectId: string; resolveSender(): Promise<{ sender: OutreachDeps["sender"]; sendRaw: OutreachDeps["sendRaw"] } | { error: string }> }
  | { ok: false; response: NextResponse };

/** Authenticates and wires the real ports (leads lookup, store, credits). Gmail is resolved lazily by resolveSender(). */
export async function outreachContext(): Promise<OutreachContext> {
  const common = { now: () => new Date(), store: outreachStoreForDeployment(), log: (m: string) => console.warn(`[outreach] ${m}`) };
  const config = { signingSecret: process.env.NOTIFY_SIGNING_SECRET?.trim() || null, appUrl: appUrlFrom(process.env) };

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId = (setting?.value as string | null) ?? null;
    if (!projectId) return { ok: false, response: NextResponse.json({ error: "No active project." }, { status: 422 }) };
    const userId = user.id;

    return {
      ok: true,
      userId,
      projectId,
      deps: {
        ...common, ...config, userId, projectId,
        async loadLeads(ids) {
          const { data, error } = await db.from("leads").select(LEAD_COLUMNS).eq("user_id", userId).eq("project_id", projectId).in("id", ids);
          if (error) throw new Error(error.message);
          return ((data ?? []) as LeadDbRow[]).map(toRow);
        },
        async markLead(u) {
          await db
            .from("leads")
            .update({
              email_status: u.status,
              emailed_at: u.status === "sent" ? u.sentAt.toISOString() : null,
              gmail_thread_id: u.threadId ?? null,
              gmail_message_id: u.messageId ?? null,
            })
            .eq("user_id", userId).eq("project_id", projectId).eq("id", u.leadId);
        },
        async recordCredits(credits) {
          let recorded = 0;
          for (let i = 0; i < credits; i++) {
            try {
              await spendCredits(userId, "outreach_send", { projectId });
              recorded++;
            } catch (err) {
              console.error("[outreach] credit record failed", err instanceof Error ? err.message : String(err));
              break;
            }
          }
          return recorded;
        },
        async canAfford(credits) {
          try {
            const s = await getCreditState(userId, "outreach_send");
            return !s.billingEnabled || s.balance >= s.cost * credits;
          } catch {
            return true;
          }
        },
      },
      async resolveSender() {
        const { data: conn } = await db.from("integration_connections").select("external_email").eq("user_id", userId).eq("provider", "gmail").maybeSingle();
        if (!conn?.external_email) return { error: "Gmail isn't connected — use Connect Gmail at the top of the Leads panel." };
        try {
          const accessToken = await getValidGmailAccessTokenSupabase(db, userId);
          return { sender: { email: conn.external_email as string }, sendRaw: (raw) => postGmailRaw(accessToken, raw) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Gmail isn't connected." };
        }
      },
    };
  }

  const db = getDb();
  const projectId = getActiveProjectId();
  if (!projectId) return { ok: false, response: NextResponse.json({ error: "No active project." }, { status: 422 }) };
  const userId = LOCAL_USER_ID;
  return {
    ok: true,
    userId,
    projectId,
    deps: {
      ...common, ...config, userId, projectId,
      async loadLeads(ids) {
        const rows = db.prepare(`SELECT ${LEAD_COLUMNS} FROM leads WHERE project_id = ? AND id IN (${ids.map(() => "?").join(",")})`).all(projectId, ...ids) as LeadDbRow[];
        return rows.map(toRow);
      },
      async markLead(u) {
        db.prepare("UPDATE leads SET email_status = ?, emailed_at = ?, gmail_thread_id = ?, gmail_message_id = ? WHERE id = ? AND project_id = ?")
          .run(u.status, u.status === "sent" ? u.sentAt.toISOString() : null, u.threadId ?? null, u.messageId ?? null, u.leadId, projectId);
      },
      // Credits are a hosted-platform concept; self-host records nothing.
      async recordCredits() {
        return 0;
      },
    },
    async resolveSender() {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'gmail_email'").get() as { value: string } | undefined;
      if (!row?.value) return { error: "Gmail isn't connected — connect it in Settings → API Credentials." };
      return { sender: { email: row.value }, sendRaw: (raw) => sendGmailRaw(raw) };
    },
  };
}
