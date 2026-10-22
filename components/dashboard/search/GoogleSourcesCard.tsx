"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Search } from "lucide-react";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import { useGoogleConnection } from "@/lib/query/useGoogleConnection";
import GoogleReconnectLink from "@/components/settings/GoogleReconnectLink";
import { buildGoogleCardSummary } from "@/lib/domain/integrations/googleCardSummary";

type IntegrationType = "google-search-console" | "google-analytics";
type Resource = { resourceId: string; resourceName: string; selected: boolean; usedBy?: string[] };
type Integration = { integrationType: IntegrationType; integrationId: string | null; suggestedResourceId?: string | null; resources: Resource[] };
type Account = { connectedHere: boolean; canReuse: boolean; email: string | null };
type Loaded = { account: Account; integrations: Integration[] };

const COPY: Record<IntegrationType, { title: string; empty: string; noun: string }> = {
  "google-search-console": {
    title: "Search Console site",
    empty: "No Search Console sites were found on this Google account.",
    noun: "site",
  },
  "google-analytics": {
    title: "Analytics property",
    empty: "No Analytics (GA4) properties were found on this Google account.",
    noun: "property",
  },
};

function Skeleton() {
  return (
    <div className="mb-5 animate-pulse rounded-xl border border-gray-200 bg-white p-4" aria-hidden="true">
      <div className="mb-3 h-3 w-40 rounded bg-gray-200" />
      <div className="mb-2 h-9 rounded-lg bg-gray-100" />
      <div className="h-9 rounded-lg bg-gray-100" />
    </div>
  );
}

export function PropertyPicker({
  type,
  integration,
  busy,
  healthy = true,
  onSelect,
}: {
  type: IntegrationType;
  integration: Integration;
  busy: boolean;
  /** False when Google no longer accepts the connection: the site is chosen but not working. */
  healthy?: boolean;
  onSelect: (type: IntegrationType, resourceId: string) => void;
}) {
  const copy = COPY[type];
  const selected = integration.resources.find((r) => r.selected);
  const suggested = integration.resources.find((r) => r.resourceId === integration.suggestedResourceId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return integration.resources.filter(
      (r) => !needle || r.resourceName.toLowerCase().includes(needle) || r.resourceId.toLowerCase().includes(needle),
    );
  }, [integration.resources, query]);

  if (integration.resources.length === 0) {
    return <div className="text-[12px] text-amber-600">{copy.empty}</div>;
  }

  const choose = (resourceId: string) => {
    setOpen(false);
    setQuery("");
    onSelect(type, resourceId);
  };

  const needsConfirm = !selected && suggested;
  const showList = open || (!selected && !suggested);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{copy.title}</span>
        {selected && !open && (
          <button type="button" onClick={() => setOpen(true)} className="text-xs text-gray-500 hover:text-gray-800 hover:underline">
            Change
          </button>
        )}
      </div>

      {selected && !open && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900">
          {healthy ? <Check size={14} className="shrink-0 text-emerald-600" /> : <AlertTriangle size={14} className="shrink-0 text-amber-600" aria-label="Needs reconnect" />}
          <span className="min-w-0 truncate" title={selected.resourceName}>{selected.resourceName}</span>
        </div>
      )}

      {needsConfirm && !open && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
          <div className="text-[12px] text-blue-900">
            This looks like your {copy.noun}: <strong className="break-all">{suggested.resourceName}</strong>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => choose(suggested.resourceId)}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
            >
              Use this {copy.noun}
            </button>
            <button type="button" onClick={() => setOpen(true)} className="text-[12px] text-blue-800 hover:underline">
              Choose another
            </button>
          </div>
        </div>
      )}

      {showList && (
        <div className="rounded-lg border border-gray-200 bg-white">
          {integration.resources.length > 6 && (
            <label className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
              <Search size={13} className="text-ui-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search your ${integration.resources.length} ${copy.noun}s`}
                className="w-full bg-transparent text-[12px] outline-none placeholder:text-gray-400"
                aria-label={`Search ${copy.noun}s`}
              />
            </label>
          )}
          <ul role="listbox" aria-label={copy.title} className="max-h-56 overflow-y-auto py-1">
            {visible.length === 0 && <li className="px-3 py-2 text-[12px] text-gray-500">No match.</li>}
            {visible.map((r) => (
              <li key={r.resourceId} role="option" aria-selected={r.selected}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose(r.resourceId)}
                  className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-[12px] hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block break-all text-gray-900">{r.resourceName}</span>
                    {r.usedBy && r.usedBy.length > 0 && (
                      <span className="block text-xs text-gray-500">Also used by {r.usedBy.join(", ")}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {r.resourceId === integration.suggestedResourceId && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">Suggested</span>
                    )}
                    {r.selected && <Check size={13} className="text-emerald-600" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export type GoogleReadiness = { ready: boolean };

/**
 * Platform mode, SEO tab: connect Google once per account, then choose which
 * Search Console site and Analytics property belong to THIS project. A new
 * project reuses the connected account (no second consent screen) and picks
 * its own site from the account's list. The match for the project's website
 * is pre-suggested but never applied without the user's confirmation.
 */
export default function GoogleSourcesCard({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }) {
  const { project } = useProject();
  const projectId = project?.id;
  const queryClient = useQueryClient();

  const resources = useQuery({
    queryKey: qk.googleResources(projectId),
    queryFn: async (): Promise<Loaded> => {
      const json = await fetchJson<Partial<Loaded>>("/api/project/integrations/google/resources");
      return {
        account: json.account ?? { connectedHere: false, canReuse: false, email: null },
        integrations: json.integrations ?? [],
      };
    },
    enabled: Boolean(projectId),
  });
  const data = resources.data;
  const [expanded, setExpanded] = useState(false);
  const health = useGoogleConnection(projectId);

  // A changed connection or property changes what Google data the project can see.
  const change = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) =>
      fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.googleResources(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.traffic(projectId) }),
      ]),
  });
  const busy = change.isPending;
  const error = change.error instanceof Error ? change.error.message : null;
  const post = (url: string, body?: unknown) => change.mutate({ url, body });

  const ready = Boolean(
    data &&
      data.integrations.some((i) => i.resources.some((r) => r.selected)) &&
      data.integrations.every((i) => i.resources.length === 0 || i.resources.some((r) => r.selected)),
  );
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  const chosen = (type: IntegrationType) => data?.integrations.find((i) => i.integrationType === type)?.resources.find((r) => r.selected)?.resourceName ?? null;
  const summary = data
    ? buildGoogleCardSummary({
        health,
        account: data.account,
        selected: { site: chosen("google-search-console"), property: chosen("google-analytics") },
        ready,
      })
    : { mode: "full" as const };

  if (!projectId) return null;
  if (resources.isPending) return <Skeleton />;
  if (resources.isError || !data) {
    return (
      <div className="mb-5 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
        <span>Couldn&apos;t load your Google connection.</span>
        <button type="button" onClick={() => resources.refetch()} className="font-medium underline">
          Retry
        </button>
      </div>
    );
  }

  const { account, integrations } = data;

  if (summary.mode === "connect") {
    return (
      <div className="mb-5 rounded-xl border border-gray-200 bg-white px-3 py-2.5" data-testid="google-connect-row">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="min-w-0 text-[12px] text-gray-600">Google isn&apos;t connected. Connect it to see real search rankings and traffic.</span>
          {summary.canReuse ? (
            <span className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => post("/api/project/integrations/google/use-account")}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
              >
                {busy ? "Connecting…" : `Use ${account.email ?? "your connected Google account"}`}
              </button>
              <a href="/api/auth/google-analytics/connect?return=dashboard" className="text-xs text-gray-500 hover:text-gray-800 hover:underline">
                Different account
              </a>
            </span>
          ) : (
            <a
              href="/api/auth/google-analytics/connect?return=dashboard"
              className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
            >
              Connect Google
            </a>
          )}
        </div>
        {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
      </div>
    );
  }

  if (summary.mode === "summary" && !expanded) {
    return (
      <div
        data-testid="google-summary-row"
        className={`mb-5 rounded-xl border px-3 py-2 ${summary.tone === "warn" ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-gray-700">
            {summary.tone === "warn" ? <AlertTriangle size={14} className="shrink-0 text-amber-600" aria-hidden="true" /> : <Check size={14} className="shrink-0 text-emerald-600" aria-hidden="true" />}
            <span className="min-w-0 truncate">
              <span className="font-medium text-gray-900">{summary.site ?? "No Search Console site"}</span>
              {summary.property ? <span className="text-gray-500"> · {summary.property}</span> : null}
              <span className="text-gray-500"> · {summary.syncLabel}</span>
            </span>
          </div>
          <button
            type="button"
            aria-expanded={false}
            aria-controls="google-data-card"
            onClick={() => setExpanded(true)}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-gray-500 hover:text-gray-800 hover:underline"
          >
            Google data <ChevronDown size={12} />
          </button>
        </div>
        {summary.message && (
          <div role="alert" className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-amber-800">
            <span className="min-w-0">{summary.message}</span>
            {summary.showReconnect && <GoogleReconnectLink returnTo="dashboard" />}
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="google-data-card" className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h4 className="text-[13px] font-semibold text-gray-900">Google data for {project?.name ?? "this project"}</h4>
        <span className="flex min-w-0 items-baseline gap-3">
          {account.email && <span className="truncate text-xs text-gray-500">{account.email}</span>}
          {summary.mode === "summary" && (
            <button
              type="button"
              aria-expanded={true}
              aria-controls="google-data-card"
              onClick={() => setExpanded(false)}
              className="shrink-0 text-xs text-gray-500 hover:text-gray-800 hover:underline"
            >
              Hide
            </button>
          )}
        </span>
      </div>
      {health.showReconnect && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <span className="min-w-0">{health.message}</span>
          <GoogleReconnectLink returnTo="dashboard" />
        </div>
      )}
      <div className="space-y-4">
        {integrations.map((integration) => (
          <PropertyPicker
            key={integration.integrationType}
            healthy={!health.showReconnect}
            type={integration.integrationType}
            integration={integration}
            busy={busy}
            onSelect={(type, resourceId) => post("/api/project/integrations/google/resources", { integrationType: type, resourceId })}
          />
        ))}
      </div>
      {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
      <p className="mt-3 flex items-center gap-1 text-xs text-ui-subtle">
        <ChevronDown size={11} className="rotate-[-90deg]" /> Each project can use a different site and property from the same Google account.
      </p>
    </div>
  );
}
