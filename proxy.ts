import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";
import { FEATURES } from "@/lib/features";

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

  // Self-host mode intentionally has no Supabase dependency.
  if (!hasSupabaseConfig) {
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|lottie|wasm)$).*)",
  ],
};
