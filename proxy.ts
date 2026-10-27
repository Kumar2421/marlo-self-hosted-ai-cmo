import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";
import { FEATURES } from "@/lib/features";
import { checkSelfHostAccess } from "@/lib/security/selfHostAccess";

export async function proxy(request: NextRequest) {
  const hasSupabaseConfig = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  // Hosted/platform mode must fail closed when its authentication backend is
  // not configured. Falling through to an unauthenticated app would expose
  // protected routes with no session enforcement.
  if (FEATURES.PLATFORM_MODE && !hasSupabaseConfig) {
    return new NextResponse("Platform authentication is not configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Self-host mode intentionally has no Supabase dependency. It has no sign-in either, so a server
  // reachable from the internet should set MARLO_ACCESS_PASSWORD (HTTP Basic, any user name).
  if (!hasSupabaseConfig) {
    const access = checkSelfHostAccess({
      password: process.env.MARLO_ACCESS_PASSWORD,
      authorization: request.headers.get("authorization"),
      pathname: request.nextUrl.pathname,
    });
    if (!access.allow) {
      return new NextResponse("Authentication required.", {
        status: 401,
        headers: { "WWW-Authenticate": access.challenge, "Cache-Control": "no-store" },
      });
    }
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|lottie|wasm)$).*)",
  ],
};
