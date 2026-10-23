import type { SupabaseClient } from "@supabase/supabase-js";
import { OutreachNotSetUpError, type OutreachStore } from "./outreachStore.ts";

type PgError = { code?: string; message?: string } | null;

/** 42P01 = undefined_table (Postgres), PGRST205 = table not in PostgREST's schema cache. */
function check(error: PgError): void {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205" || /could not find the table|does not exist/i.test(error.message ?? "")) {
    throw new OutreachNotSetUpError();
  }
  throw new Error(error.message ?? "outreach store error");
}

/** Hosted outreach store. Must be given the service-role client: the tables have no policies for anon/authenticated. */
export function supabaseOutreachStore(db: SupabaseClient): OutreachStore {
  return {
    async optedOut(userId, emails) {
      if (emails.length === 0) return new Set();
      const { data, error } = await db.from("outreach_optouts").select("email").eq("user_id", userId).in("email", emails);
      check(error);
      return new Set((data ?? []).map((r: { email: string }) => r.email));
    },
    async lastSends(userId, emails, since) {
      const out = new Map<string, Date>();
      if (emails.length === 0) return out;
      const { data, error } = await db
        .from("outreach_sends")
        .select("email, sent_at")
        .eq("user_id", userId)
        .gte("sent_at", since.toISOString())
        .in("email", emails)
        .order("sent_at", { ascending: false });
      check(error);
      for (const r of (data ?? []) as { email: string; sent_at: string }[]) {
        if (!out.has(r.email)) out.set(r.email, new Date(r.sent_at));
      }
      return out;
    },
    async countSince(userId, since) {
      const { count, error } = await db
        .from("outreach_sends")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("sent_at", since.toISOString());
      check(error);
      return count ?? 0;
    },
    async recordSend(r) {
      const { error } = await db.from("outreach_sends").insert({
        user_id: r.userId,
        project_id: r.projectId,
        lead_id: r.leadId,
        email: r.email,
        sent_at: r.sentAt.toISOString(),
        message_id: r.messageId,
      });
      check(error);
    },
    async addOptout(userId, email, reason, at = new Date()) {
      const { error } = await db
        .from("outreach_optouts")
        .upsert({ user_id: userId, email, reason, created_at: at.toISOString() }, { onConflict: "user_id,email", ignoreDuplicates: true });
      check(error);
    },
  };
}
