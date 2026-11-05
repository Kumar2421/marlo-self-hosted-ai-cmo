import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeHost } from "@/lib/domain/documents/competitorCandidates";
import { normalizeProfile, profileProblems, suggestProfile, type LeadProfile } from "@/lib/domain/leads/leadProfile";
import { getLeadProfile, saveLeadProfile } from "@/lib/domain/leads/leadProfileStore";
import { getLeadProfile as getLeadProfileSupabase, saveLeadProfile as saveLeadProfileSupabase } from "@/lib/domain/leads/leadProfileStoreSupabase";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";
import { getOfferModel as getOfferModelSqlite } from "@/lib/domain/offer/offerModelStore";
import { getOfferModel as getOfferModelSupabase } from "@/lib/domain/offer/offerModelStoreSupabase";

type ProjectBits = { name: string; category: string | null };

/** The project's strategy docs and competitor domains, the raw material for a suggested profile. */
async function loadSuggestionInputs(ctx: { userId: string | null; projectId: string; supabase?: Parameters<typeof getLeadProfileSupabase>[0] }) {
  const docs: Record<string, string> = {};
  let competitors: string[] = [];

  if (ctx.supabase && ctx.userId) {
    const { data: rows } = await ctx.supabase
      .from("project_documents")
      .select("doc_type, content")
      .eq("user_id", ctx.userId)
      .eq("project_id", ctx.projectId)
      .in("doc_type", ["marketing_strategy", "product_info"]);
    for (const row of rows ?? []) docs[row.doc_type as string] = (row.content as string) ?? "";
    const { data: comps } = await ctx.supabase.from("project_competitors").select("url").eq("user_id", ctx.userId).eq("project_id", ctx.projectId);
    competitors = (comps ?? []).map((c) => normalizeHost(c.url as string));
  } else {
    const db = getDb();
    const rows = db
      .prepare("SELECT doc_type, content FROM project_documents WHERE project_id = ? AND doc_type IN ('marketing_strategy', 'product_info')")
      .all(ctx.projectId) as { doc_type: string; content: string }[];
    for (const row of rows) docs[row.doc_type] = row.content ?? "";
    const comps = db.prepare("SELECT url FROM project_competitors WHERE project_id = ?").all(ctx.projectId) as { url: string }[];
    competitors = comps.map((c) => normalizeHost(c.url));
  }

  return { marketingStrategy: docs.marketing_strategy ?? null, productInfo: docs.product_info ?? null, competitors: competitors.filter(Boolean) };
}

/** The saved lead profile, or a suggested draft from the product's own docs when none exists yet. */
export async function GET() {
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, project, supabase } = auth.context;

  // What Marlo read from the site. Shown as evidence in the wizard and used to pre-fill a new profile.
  const offer = supabase && userId ? await getOfferModelSupabase(supabase, userId, projectId) : getOfferModelSqlite(getDb(), projectId);

  const stored = supabase && userId ? await getLeadProfileSupabase(supabase, userId, projectId) : getLeadProfile(getDb(), projectId);
  if (stored) return NextResponse.json({ profile: stored, suggestion: null, offer });

  const bits = project as unknown as ProjectBits;
  const inputs = await loadSuggestionInputs({ userId, projectId, supabase });
  return NextResponse.json({
    profile: null,
    suggestion: suggestProfile({ ...inputs, category: bits.category, name: bits.name, offer }),
    offer,
  });
}

/** Save the profile. With `confirm: true` it must be complete, and is stamped as confirmed. */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;

  let profile: LeadProfile = normalizeProfile(body?.profile);
  if (body?.confirm === true) {
    const problems = profileProblems(profile);
    if (problems.length > 0) return NextResponse.json({ error: problems[0], problems }, { status: 400 });
    profile = { ...profile, confirmedAt: new Date().toISOString() };
  } else {
    profile = { ...profile, confirmedAt: null };
  }

  try {
    if (supabase && userId) await saveLeadProfileSupabase(supabase, userId, projectId, profile);
    else saveLeadProfile(getDb(), projectId, profile);
    return NextResponse.json({ profile });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save the lead profile." }, { status: 500 });
  }
}
