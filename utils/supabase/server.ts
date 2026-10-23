import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { applySessionPersistence, isSessionOnly } from "./sessionPersistence";

export async function createClient() {
  const cookieStore = await cookies();
  const sessionOnly = isSessionOnly(cookieStore.getAll());

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, applySessionPersistence(options, sessionOnly))
            );
          } catch {
            // Called from a Server Component — ignorable when middleware
            // is already refreshing sessions on every request.
          }
        },
      },
    }
  );
}
