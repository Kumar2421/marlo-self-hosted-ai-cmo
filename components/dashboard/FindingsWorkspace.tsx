"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, CircleDot, Loader2, RefreshCw } from "lucide-react";
import type { Finding, FindingStatus } from "@/lib/domain/findings/findingTypes";
import { countFindings, findingTitle, pagePath } from "@/lib/domain/findings/findingDisplay";
import { friendlyGithubError } from "@/lib/domain/github/friendlyGithubError";
import { useToast } from "@/components/dashboard/Toast";
import SidePanel from "@/components/shared/SidePanel";
import { SkeletonCard, SkeletonStats } from "@/components/shared/Skeleton";
import FindingDetail, { STATUS_LABEL, severityClass, statusClass } from "./findings/FindingDetail";
import { useFindings } from "./findings/useFindings";

const STATUS_ACTION: Partial<Record<FindingStatus, { next: FindingStatus; label: string }>> = {
  new: { next: "acknowledged", label: "Acknowledge" },
  acknowledged: { next: "fixing", label: "Start fixing" },
  fixing: { next: "fixed", label: "Mark fixed" },
  failed: { next: "fixing", label: "Resume fixing" },
};

const CAN_RECHECK = new Set<FindingStatus>(["fixing", "fixed", "failed"]);

function dotClass(severity: Finding["severity"]) {
  return severity === "critical" ? "text-red-500" : severity === "warning" ? "text-amber-500" : "text-gray-400";
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "good" }) {
  const color = tone === "bad" && value > 0 ? "text-red-600" : tone === "good" && value > 0 ? "text-emerald-600" : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

/**
 * Findings: a compact, prioritized list in the dashboard column; the full
 * detail (evidence, what to do, tracked actions, progress) opens in a
 * slide-over so it has room, with the main actions pinned at the bottom.
 */
export default function FindingsWorkspace() {
  const { list, update } = useFindings();
  const { show } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verification, setVerification] = useState<"verified" | "failed" | null>(null);

  const findings = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(() => countFindings(findings), [findings]);
  const selected = findings.find((f) => f.id === selectedId) ?? null;

  // Coming back from GitHub (?finding=<id>, ?github=connected or ?github_error=...) reopens the finding and says what happened.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("finding");
    const githubError = params.get("github_error");
    const connected = params.get("github") === "connected";
    if (!wanted && !githubError && !connected) return;
    if (githubError) show(`GitHub: ${friendlyGithubError(githubError).message}`);
    else if (connected) show("GitHub connected. Now pick the repository.");
    if (wanted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(wanted);
    }
    params.delete("finding");
    params.delete("github");
    params.delete("github_error");
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
  }, [show]);

  const select = (id: string | null) => {
    setSelectedId(id);
    setVerification(null);
    update.reset();
  };

  const run = (body: Record<string, string>) => {
    if (!selected) return;
    setVerification(null);
    update.mutate(
      { id: selected.id, body },
      {
        onSuccess: (data) => {
          if (body.action === "recheck") setVerification(data.verification?.status ?? null);
        },
      },
    );
  };

  if (list.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <SkeletonStats count={4} />
        <SkeletonCard rows={3} />
        <SkeletonCard rows={3} />
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {list.error.message}
        <button type="button" onClick={() => list.refetch()} className="ml-3 font-medium underline">
          Retry
        </button>
      </div>
    );
  }

  const primary = selected ? STATUS_ACTION[selected.status] : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Findings</h3>
          <p className="mt-0.5 text-[11px] text-gray-500">The most important problems first. Open one to see why it matters and what to do.</p>
        </div>
        <button
          type="button"
          onClick={() => list.refetch()}
          title="Refresh findings"
          aria-label="Refresh findings"
          className="shrink-0 rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
        >
          {list.isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Needs attention" value={counts.needsAttention} />
        <Stat label="Critical" value={counts.critical} tone="bad" />
        <Stat label="Warnings" value={counts.warning} />
        <Stat label="Verified" value={counts.verified} tone="good" />
      </div>

      {findings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
          <Check className="mx-auto mb-2 text-emerald-500" size={22} />
          <p className="text-sm font-medium text-gray-800">No findings yet</p>
          <p className="mt-1 text-[12px] text-gray-500">
            Run an SEO audit first. Detected on-page and Lighthouse issues appear here with evidence and recommendations.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {findings.map((finding) => (
            <li key={finding.id} className="border-t border-gray-100 first:border-t-0">
              <button
                type="button"
                onClick={() => select(finding.id)}
                className="flex w-full items-start gap-2 px-3 py-3 text-left transition-colors hover:bg-gray-50"
              >
                <CircleDot size={14} className={`mt-0.5 shrink-0 ${dotClass(finding.severity)}`} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-[13px] font-medium leading-5 text-gray-900">{findingTitle(finding)}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${statusClass(finding.status)}`}>
                      {STATUS_LABEL[finding.status]}
                    </span>
                    <span className="min-w-0 truncate text-[11px] text-gray-500" title={finding.url ?? undefined}>
                      {pagePath(finding.url)}
                    </span>
                  </span>
                </span>
                <ChevronRight size={14} className="mt-1 shrink-0 text-gray-300" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <SidePanel
        open={Boolean(selected)}
        onClose={() => select(null)}
        title={selected ? findingTitle(selected) : "Finding"}
        subtitle={
          selected && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${severityClass(selected.severity)}`}>
                {selected.severity}
              </span>
              <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${statusClass(selected.status)}`}>
                {STATUS_LABEL[selected.status]}
              </span>
              {selected.url && (
                <a href={selected.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[#00846f] hover:underline">
                  {selected.url}
                </a>
              )}
            </span>
          )
        }
        footer={
          selected && (primary || CAN_RECHECK.has(selected.status)) ? (
            <div className="flex flex-wrap gap-2">
              {primary && (
                <button
                  type="button"
                  disabled={update.isPending}
                  onClick={() => run({ status: primary.next })}
                  className="rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
                >
                  {update.isPending && !update.variables?.body.action ? <Loader2 size={13} className="inline animate-spin" /> : primary.label}
                </button>
              )}
              {CAN_RECHECK.has(selected.status) && (
                <button
                  type="button"
                  disabled={update.isPending}
                  onClick={() => run({ action: "recheck" })}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {update.isPending && update.variables?.body.action === "recheck" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {update.isPending && update.variables?.body.action === "recheck" ? "Checking…" : "Re-check"}
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {selected && (
          <FindingDetail
            finding={selected}
            verification={verification}
            error={update.error instanceof Error ? update.error.message : null}
          />
        )}
      </SidePanel>
    </div>
  );
}
