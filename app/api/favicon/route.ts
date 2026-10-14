import { NextRequest, NextResponse } from "next/server";
import { getCachedFavicon } from "@/lib/domain/shared/faviconFetch";
import { assertSafeUserUrl, INVALID_USER_URL_MESSAGE } from "@/lib/domain/net/publicUrl";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createFixedWindowLimiter } from "@/lib/domain/shared/fixedWindowLimiter";

/**
 * Website favicon for the UI. Fetched on the server through the guarded fetcher, never by the
 * browser (the browser cannot pin DNS, and the page URL is user-supplied).
 */
/** Per client: 30 lookups a minute. Bounded key set, so a flood of client keys cannot grow memory. */
const rateLimit = createFixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 10_000 });

/** Behind Vercel, x-real-ip is set by the platform. The leftmost x-forwarded-for is client-controlled and never used. */
function clientKey(req: NextRequest): string {
  if (process.env.VERCEL) return req.headers.get("x-real-ip")?.trim() || "unknown";
  return "unknown";
}

export async function GET(req: NextRequest) {
  let key = clientKey(req);
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    key = user.id;
  }
  if (!rateLimit(key)) {
    return NextResponse.json({ error: "Too many requests. Please wait a minute and try again." }, { status: 429, headers: { "Retry-After": "60" } });
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
