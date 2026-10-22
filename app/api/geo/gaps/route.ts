import { NextRequest, NextResponse } from "next/server";
import { resolveGeoContext } from "@/lib/domain/geo/geoContext";
import { trackGeoGap } from "@/lib/domain/geo/geoService";

/** "Track as a fix" for one question the AI answers without naming you. The gap is re-derived server side from stored runs; the client only names the prompt. */
export async function POST(req: NextRequest) {
  const r = await resolveGeoContext();
  if ("response" in r) return r.response;
  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: string };
  if (typeof prompt !== "string" || !prompt.trim()) return NextResponse.json({ error: "Name the question to track." }, { status: 400 });
  try {
    const result = await trackGeoGap(r.ctx, prompt.trim());
    if (result.status === "no-project") return NextResponse.json({ error: "No project website linked yet." }, { status: 422 });
    if (result.status === "no-gap") return NextResponse.json({ finding: null, message: "Recent answers to this question do name you, so there is nothing to track." });
    return NextResponse.json({ finding: result.finding });
  } catch {
    return NextResponse.json({ error: "Could not add this to findings. Try again in a moment." }, { status: 502 });
  }
}
