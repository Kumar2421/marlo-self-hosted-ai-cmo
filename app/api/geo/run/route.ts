import { NextResponse } from "next/server";
import { resolveGeoContext } from "@/lib/domain/geo/geoContext";
import { runProjectGeo } from "@/lib/domain/geo/geoService";
import { summariseRun } from "@/lib/domain/geo/runner";

export const maxDuration = 60;

/** Manual "Run now". Idempotent per day: runs already stored today count toward each prompt's three. */
export async function POST() {
  const r = await resolveGeoContext();
  if ("response" in r) return r.response;
  try {
    const summary = await runProjectGeo(r.ctx, { budgetMs: 45_000 });
    if (summary.noPrompts) {
      return NextResponse.json({ error: "No prompts to track yet. Connect Search Console or add a prompt first." }, { status: 422 });
    }
    if (summary.noEngines) {
      return NextResponse.json({ error: "No AI visibility method is set up. Add a Gemini key, or Tavily plus a Groq connection, in Settings." }, { status: 422 });
    }
    if (summary.inFlight) {
      return NextResponse.json({ error: "A check is already running for this project. Try again in a minute." }, { status: 409 });
    }
    // `outcome` is the honest one-liner (what failed and why); `summary` keeps the detail.
    return NextResponse.json({ summary, outcome: summariseRun(summary) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
