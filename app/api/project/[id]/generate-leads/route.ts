import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { generateAutoLeads } from "@/lib/domain/leads/autoGenerateLeads";
import { canFetchLeadsToday } from "@/lib/entitlements";
import { runClaimedLeadRefresh, supabaseLeadStampStore } from "@/lib/jobs/leadRefreshClaim";
import { AUTO_LEAD_WINDOW_MS, autoLeadCooldownRemainingMs, retryAfterSeconds } from "@/lib/domain/leads/autoLeadWindow";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

const CREATION_LIMIT = 10;

/**
 * Free, platform-only lead-generation baseline — called once right after a
 * new project's crawl succeeds (same place generate-description and
 * competitor discovery already run from). Self-host has no equivalent: this
 * is a hosted-plan convenience, not a self-host feature, so it 404s there
 * rather than silently doing nothing — project-store.tsx's caller only
 * invokes this route in platform mode to begin with.
 *
 * The daily refresh (5 new leads/day) is a separate cron route
 * (app/api/cron/leads-refresh/route.ts) that calls the same
 * autoGenerateLeads() helper — this route only covers the one-time
 * creation-time batch.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ error: "Not available in self-host mode." }, { status: 404 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = createServiceClient();
  const { data: project, error: projectError } = await db
    .from("projects")
    .select("id, name, category, leads_auto_last_at")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

  const nowMs = Date.now();
  const cooldownMs = autoLeadCooldownRemainingMs(project.leads_auto_last_at, nowMs);
  if (cooldownMs > 0) {
    return NextResponse.json(
      { error: "Leads were already generated for this project in the last 24 hours. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(cooldownMs)) } },
    );
  }

  // The creation-time baseline (no stamp yet) runs as before. Any repeat call also has to fit the
  // plan's daily lead allowance, the same check the manual lead search uses.
  if (project.leads_auto_last_at) {
    const allowance = await canFetchLeadsToday(user.id);
    if (!allowance.allowed) {
      return NextResponse.json({ error: allowance.message ?? "Daily lead limit reached." }, { status: 429 });
    }
  }

  // Compare-and-set claim before generating: a concurrent call that lost the race gets a 429 instead
  // of a second run. The stamp is kept when generation succeeds, whether or not it finds anyone. If
  // generation throws, the previous stamp is restored so the user can try again.
  const run = await runClaimedLeadRefresh(
    supabaseLeadStampStore(db),
    {
      projectId: id,
      cutoffIso: new Date(nowMs - AUTO_LEAD_WINDOW_MS).toISOString(),
      nowIso: new Date(nowMs).toISOString(),
      previousIso: project.leads_auto_last_at,
    },
    () => generateAutoLeads(db, user.id, project, CREATION_LIMIT),
  ).catch((): null => null);

  if (run === null) {
    return NextResponse.json({ error: "Lead generation failed. Try again later." }, { status: 502 });
  }
  if (run.status === "refused") {
    return NextResponse.json(
      { error: "Leads were already generated for this project in the last 24 hours. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(60_000)) } },
    );
  }

  return NextResponse.json({ added: run.value.added, reason: run.value.reason, message: run.value.message });
}
