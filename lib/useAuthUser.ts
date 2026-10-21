"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/utils/supabase/client";
import { fetchAuthUser, syncAuthUser } from "@/lib/query/authUser";

export type AuthUser = {
  name: string;
  initials: string;
  email: string;
};

function deriveDisplay(email: string, fullName?: string | null): { name: string; initials: string } {
  const name = fullName?.trim() || email.split("@")[0];
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "U";
  return { name, initials };
}

/** Reads the signed-in Supabase user for display in the account menu.
 * Returns null while loading or if no Supabase project is configured yet
 * (credentials pending) — callers should fall back to a placeholder. */
export function useAuthUser(): { user: AuthUser | null; loading: boolean } {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(configured);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!configured) return;

    const supabase = createClient();
    let mounted = true;

    // Shared with the providers store: one /auth/v1/user call for the whole app.
    fetchAuthUser(queryClient)
      .then((authUser) => {
        if (!mounted) return;
        if (authUser) {
          const { name, initials } = deriveDisplay(
            authUser.email ?? "",
            authUser.user_metadata?.full_name
          );
          setUser({ name, initials, email: authUser.email ?? "" });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      syncAuthUser(queryClient, session?.user ?? null);
      if (session?.user) {
        const { name, initials } = deriveDisplay(
          session.user.email ?? "",
          session.user.user_metadata?.full_name
        );
        setUser({ name, initials, email: session.user.email ?? "" });
      } else {
        setUser(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient, configured]);

  return { user, loading };
}
