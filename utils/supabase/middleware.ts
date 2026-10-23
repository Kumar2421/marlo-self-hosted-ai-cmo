import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  applySessionPersistence,
  isProtectedPath,
  isSessionOnly,
  isTransientAuthError,
} from "./sessionPersistence";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const sessionOnly = isSessionOnly(request.cookies.getAll());

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, applySessionPersistence(options, sessionOnly))
          );
        },
      },
    }
  );

  // Do not add logic between createServerClient and auth.getUser() — it
  // refreshes the session token, and separating them risks stale/expired
  // sessions slipping through.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // "/" is the public landing page — only the actual app (dashboard,
  // settings) requires a session. Everything else (marketing, login,
  // auth callbacks, API routes called by already-authenticated pages)
  // is left alone here.
  const path = request.nextUrl.pathname;
  const isProtected = isProtectedPath(path);

  // A network blip or Supabase 5xx while refreshing is not "signed out": let
  // the request through (API routes still verify the user) instead of
  // bouncing a signed-in person to /login.
  if (!user && isProtected && isTransientAuthError(userError)) {
    return supabaseResponse;
  }

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
