"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "./fetchJson";
import { qk } from "./keys";
import { googleHealthView, type GoogleHealthInput, type GoogleHealthView } from "@/lib/domain/integrations/googleHealthView";

/**
 * Google connection health for the active project, from the status the server
 * already exposes. One shared query, so Settings, SEO and GEO agree. A failed
 * read is `unknown` (shows nothing alarming), never "healthy".
 */
export function useGoogleConnection(projectId: string | undefined): GoogleHealthView {
  const query = useQuery({
    queryKey: qk.googleConnection(projectId),
    enabled: Boolean(projectId),
    staleTime: 60_000,
    queryFn: async () => (await fetchJson<{ google?: GoogleHealthInput }>("/api/project/integrations")).google ?? null,
  });
  return googleHealthView(query.data);
}
