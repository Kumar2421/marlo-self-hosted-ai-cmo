import type { QueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { qk } from "./keys";

/**
 * The signed-in Supabase user, shared by everything on the client that needs
 * it (providers store, account menu, ...). Each caller used to run its own
 * supabase.auth.getUser() - a network round trip to /auth/v1/user - so the
 * dashboard made that call twice on every load. fetchQuery joins an in-flight
 * request and reuses a fresh result, so the whole app makes one.
 */
const AUTH_USER_STALE_MS = 60_000;

export function fetchAuthUser(queryClient: QueryClient): Promise<User | null> {
  return queryClient.fetchQuery({
    queryKey: qk.authUser(),
    staleTime: AUTH_USER_STALE_MS,
    queryFn: async () => {
      const { data, error } = await createClient().auth.getUser();
      // A transient network failure must not be cached as "signed out".
      if (error && error.name === "AuthRetryableFetchError") throw error;
      return data.user ?? null;
    },
  });
}

/** Keeps the shared copy in step with sign-in, sign-out and token refresh events. */
export function syncAuthUser(queryClient: QueryClient, user: User | null) {
  queryClient.setQueryData(qk.authUser(), user);
}
