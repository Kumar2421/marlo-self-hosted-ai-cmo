"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import { useGoogleServices } from "@/lib/query/useGoogleConnection";
import { useGoogleResources } from "@/components/dashboard/search/GoogleSourcesCard";
import { googleConnectHref, type ServiceRow } from "@/lib/googleOAuthScopes";

function StateText({ row }: { row: ServiceRow }) {
  if (row.state === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700">
        <Check size={13} aria-hidden="true" /> Connected
      </span>
    );
  }
  if (row.state === "needs_reconnect") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-amber-700">
        <AlertTriangle size={13} aria-hidden="true" /> Needs reconnect
      </span>
    );
  }
  return <span className="text-[12px] text-gray-500">Not connected</span>;
}

/**
 * The one place in the dashboard that connects Google: Search Console and Analytics are two
 * independent rows, each with its own Connect / Connected / Reconnect, so a user can connect
 * only one. Everywhere else shows plain text pointing here.
 */
export default function GoogleConnectRows() {
  const { project } = useProject();
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const { loaded, rows } = useGoogleServices(projectId);
  const resources = useGoogleResources(projectId);
  const account = resources.data?.account;

  const reuse = useMutation({
    mutationFn: () => fetchJson("/api/project/integrations/google/use-account", { method: "POST" }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.googleConnection(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.googleResources(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.traffic(projectId) }),
      ]),
  });

  if (!projectId || !loaded) return null;
  const noneConnected = rows.every((r) => r.state === "not_connected");

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white" data-testid="google-connect-rows">
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => (
          <li key={row.service} className="flex items-center justify-between gap-3 px-3 py-2.5" data-testid={`google-row-${row.service}`}>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-gray-900">{row.label}</div>
              <StateText row={row} />
            </div>
            {row.action && (
              <a
                href={googleConnectHref(row.service)}
                className="shrink-0 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
              >
                {row.action}
              </a>
            )}
          </li>
        ))}
      </ul>
      {noneConnected && account?.canReuse && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-[12px] text-gray-600">
          <span className="min-w-0 truncate">Already connected on another project: {account.email ?? "your Google account"}</span>
          <button
            type="button"
            disabled={reuse.isPending}
            onClick={() => reuse.mutate()}
            className="shrink-0 font-medium text-gray-900 underline disabled:opacity-50"
          >
            {reuse.isPending ? "Connecting…" : "Use this account"}
          </button>
        </div>
      )}
      {reuse.error instanceof Error && <p className="border-t border-gray-100 px-3 py-2 text-[12px] text-red-600">{reuse.error.message}</p>}
    </div>
  );
}
