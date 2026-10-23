import { createBrowserClient } from "@supabase/ssr";
import {
  applySessionPersistence,
  isSessionOnly,
  parseCookieHeader,
} from "./sessionPersistence";

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function serializeCookie(name: string, value: string, options: Record<string, unknown> = {}): string {
  let out = `${name}=${encodeURIComponent(value)}`;
  if (options.path) out += `; path=${options.path}`;
  if (typeof options.maxAge === "number") out += `; max-age=${options.maxAge}`;
  if (options.expires instanceof Date) out += `; expires=${options.expires.toUTCString()}`;
  if (options.domain) out += `; domain=${options.domain}`;
  if (options.sameSite) out += `; samesite=${options.sameSite}`;
  if (options.secure) out += "; secure";
  return out;
}

// Custom cookie adapter so token refreshes honour "Remember me": when the
// user chose a session-only login, auth cookies are written without maxAge.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          if (typeof document === "undefined") return [];
          return parseCookieHeader(document.cookie).map((c) => ({
            name: c.name,
            value: safeDecode(c.value),
          }));
        },
        setAll(cookiesToSet) {
          if (typeof document === "undefined") return;
          const sessionOnly = isSessionOnly(parseCookieHeader(document.cookie));
          cookiesToSet.forEach(({ name, value, options }) => {
            document.cookie = serializeCookie(
              name,
              value,
              applySessionPersistence(options, sessionOnly) as Record<string, unknown>
            );
          });
        },
      },
    }
  );
}
