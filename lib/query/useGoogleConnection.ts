"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "./fetchJson";
import { qk } from "./keys";
import { googleHealthView, type GoogleHealthInput, type GoogleHealthView } from "@/lib/domain/integrations/googleHealthView";
import { googleServiceRows, type ServiceRow } from "@/lib/googleOAuthScopes";

type IntegrationsPayload = { google: GoogleHealthInput | null; integrationTypes: string[] };

/** One shared read of the integrations status; every Google hook selects from it. */
function useIntegrationsStatus<T>(projectId: string | undefined, select: (data: IntegrationsPayload) => T) {
  return useQuery({
    queryKey: qk.googleConnection(projectId),
    enabled: Boolean(projectId),
    staleTime: 60_000,
    queryFn: async (): Promise<IntegrationsPayload> => {
      const json = await fetchJson<{ google?: GoogleHealthInput; integrations?: Array<{ integrationType?: string }> }>("/api/project/integrations");
      return {
        google: json.google ?? null,
        integrationTypes: (json.integrations ?? []).map((i) => i.integrationType).filter((t): t is string => typeof t === "string"),
      };
    },
    select,
  });
}

/**
 * Google connection health for the active project, from the status the server
 * already exposes. One shared query, so Settings, SEO and GEO agree. A failed
 * read is `unknown` (shows nothing alarming), never "healthy".
 */
export function useGoogleConnection(projectId: string | undefined): GoogleHealthView {
  const query = useIntegrationsStatus(projectId, (data) => data.google);
  return googleHealthView(query.data);
}

/**
 * Search Console and Analytics each have their own connected state, so a user can
 * connect only one. `loaded` is false until the status is read (rows then show nothing,
 * never a false "Not connected").
 */
export function useGoogleServices(projectId: string | undefined): { loaded: boolean; rows: ServiceRow[] } {
  const query = useIntegrationsStatus(projectId, (data) => googleServiceRows(data.integrationTypes, googleHealthView(data.google).state === "needs_reconnect"));
  return { loaded: query.data !== undefined, rows: query.data ?? [] };
}
