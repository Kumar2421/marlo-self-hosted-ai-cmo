import { NextRequest, NextResponse } from "next/server";
import { getCachedFavicon } from "@/lib/domain/shared/faviconFetch";
import { assertSafeUserUrl, INVALID_USER_URL_MESSAGE } from "@/lib/domain/net/publicUrl";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";

/**
 * Website favicon for the UI. Fetched on the server through the guarded fetcher, never by the
 * browser (the browser cannot pin DNS, and the page URL is user-supplied).
 */
export async function GET(req: NextRequest) {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get("url") ?? "";
  try {
    await assertSafeUserUrl(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : INVALID_USER_URL_MESSAGE;
    return NextResponse.json({ favicon: null, error: message }, { status: 400 });
  }

  const favicon = await getCachedFavicon(raw);
  return NextResponse.json({ favicon }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
