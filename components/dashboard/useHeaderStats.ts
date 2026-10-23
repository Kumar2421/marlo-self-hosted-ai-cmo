"use client";

import { useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import { useGoogleServices } from "@/lib/query/useGoogleConnection";
import { buildTrafficView, type TrafficResponseLike } from "@/lib/domain/analytics/trafficView";
import { countFindings } from "@/lib/domain/findings/findingDisplay";
import type { StatInput, StatsInput } from "@/lib/domain/navbar/headerCenter";
import { useFindings } from "./findings/useFindings";

/**
 * The three numbers in the top bar. They only read what the panels already
 * loaded (findings, Search Console traffic, the Leads list) from the shared
 * query cache: `enabled: false` observes an entry without ever fetching it.
 * The one request of its own is the Google connection status that Settings and
 * the SEO tab share, used to tell "not connected" from "not loaded yet".
 */
export function useHeaderStats(): StatsInput {
  const { project } = useProject();
  const pid = project?.id;

  const findings = useFindings({ enabled: false }).list;
  const traffic = useQuery<TrafficResponseLike>({ queryKey: qk.traffic(pid), enabled: false });
  const leads = useQuery<number>({ queryKey: qk.leadsCount(pid), enabled: false });
  const google = useGoogleServices(pid);

  const findingsStat: StatInput = findings.data
    ? { state: "ready", value: countFindings(findings.data).needsAttention }
    : findings.isError
      ? { state: "error" }
      : { state: "pending" };

  const view = traffic.data ? buildTrafficView(traffic.data) : null;
  const searchConsole = google.rows.find((r) => r.service === "search-console");
  const clicksStat: StatInput =
    view?.kind === "cards" && traffic.data?.totals
      ? { state: "ready", value: traffic.data.totals.clicks }
      : google.loaded && searchConsole && searchConsole.state !== "connected"
        ? { state: "connect" }
        : view?.kind === "not_connected"
          ? { state: "connect" }
          : view?.kind === "error" || view?.kind === "no_data"
            ? { state: "error" }
            : { state: "pending" };

  const leadsStat: StatInput = typeof leads.data === "number" ? { state: "ready", value: leads.data } : { state: "pending" };

  return { clicks: clicksStat, findings: findingsStat, leads: leadsStat };
}
