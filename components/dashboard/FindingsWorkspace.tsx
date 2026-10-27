"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, Check, ChevronRight, Info, Loader2, RefreshCw } from "lucide-react";
import { IconTile } from "@/components/ui/IconTile";
import type { Finding, FindingStatus } from "@/lib/domain/findings/findingTypes";
import { countFindings, explainPriority, findingCountStats, findingTitle, pagePath } from "@/lib/domain/findings/findingDisplay";
import { friendlyGithubUrlError } from "@/lib/domain/github/friendlyGithubError";
import { useToast } from "@/components/dashboard/Toast";
import { pendingOpenRequest } from "@/lib/domain/overview/fixFirst";
import SidePanel from "@/components/shared/SidePanel";
import { SkeletonCard, SkeletonStats } from "@/components/shared/Skeleton";
import FindingDetail, { STATUS_LABEL, severityClass, statusClass } from "./findings/FindingDetail";
import { useFindings } from "./findings/useFindings";
import { recheckNote, type RecheckNote } from "@/lib/domain/findings/recheckNote";
import { isVanished, vanishedNote } from "@/lib/domain/findings/vanishedFindings";

const STATUS_ACTION: Partial<Record<FindingStatus, { next: FindingStatus; label: string }>> = {
  new: { next: "acknowledged", label: "Acknowledge" },
  acknowledged: { next: "fixing", label: "Start fixing" },
  fixing: { next: "fixed", label: "Mark fixed" },
  failed: { next: "fixing", label: "Resume fixing" },
};

const CAN_RECHECK = new Set<FindingStatus>(["fixing", "fixed", "failed"]);

/** Round severity icon: red for critical, orange for warning, neutral for anything else. Colour carries the severity only. */
function SeverityIcon({ severity }: { severity: Finding["severity"] }) {
  const tone = severity === "critical" ? "danger" : severity === "warning" ? "warning" : "neutral";
  const Icon = severity === "critical" ? AlertOctagon : severity === "warning" ? AlertTriangle : Info;
  return (
    <IconTile tone={tone} size="md" round className="mt-0.5">
      <Icon size={15} aria-label={severity === "critical" ? "Critical" : severity === "warning" ? "Warning" : "Info"} role="img" />
    </IconTile>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "good" }) {
  const color = tone === "bad" && value > 0 ? "text-red-600" : tone === "good" && value > 0 ? "text-emerald-600" : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-ui-subtle">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

/**
 * Findings: a compact, prioritized list in the dashboard column; the full
 * detail (evidence, what to do, tracked actions, progress) opens in a
 * slide-over so it has room, with the main actions pinned at the bottom.
 */
export default function FindingsWorkspace({
  onRunAudit,
  auditRunning = false,
  openRequest = null,
}: {
  onRunAudit?: () => void;
  auditRunning?: boolean;
  /** Asks the workspace to open one finding's drawer (e.g. from the "Fix first" strip). */
  openRequest?: { id: string; n: number } | null;
}) {
  const { list, update } = useFindings();
  const { show } = useToast();
  // The request that mounted this tab is applied in the first render, not in a later effect: the first click on
  // the strip switches tabs and opens the drawer in one go.
  const [handledN, setHandledN] = useState<number | null>(() => (pendingOpenRequest(openRequest, null) ? openRequest!.n : null));
  const [selectedId, setSelectedId] = useState<string | null>(() => pendingOpenRequest(openRequest, null));
  const [verification, setVerification] = useState<"verified" | "failed" | null>(null);
  const [note, setNote] = useState<RecheckNote | null>(null);

  // A later click while this tab is already showing (adjusting state during render, keyed by the request's n).
  const wanted = pendingOpenRequest(openRequest, handledN);
  if (wanted && openRequest) {
    setHandledN(openRequest.n);
    setSelectedId(wanted);
  }

  const findings = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(() => countFindings(findings), [findings]);
  const selected = findings.find((f) => f.id === selectedId) ?? null;

  // Skeletons alone say nothing; only add words once a load is clearly slow, so quick loads don't flash text.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!list.isPending) return;
    const timer = setTimeout(() => setSlow(true), 1500);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [list.isPending]);

  // Coming back from GitHub (?finding=<id>, ?github=connected or ?github_error=...) reopens the finding and says what happened.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("finding");
    const githubError = params.get("github_error");
    const connected = params.get("github") === "connected";
    if (!wanted && !githubError && !connected) return;
    if (githubError) show(`GitHub: ${friendlyGithubUrlError(githubError).message}`);
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
    setNote(null);
    update.reset();
  };

  const run = (body: Record<string, string>) => {
    if (!selected) return;
    setVerification(null);
    setNote(null);
    update.mutate(
      { id: selected.id, body },
      {
        onSuccess: (data) => {
          if (body.action !== "recheck") return;
          setVerification(data.verification?.status ?? null);
          const checked = (data.finding?.evidence?.lastCheck as { reason?: string } | undefined)?.reason;
          setNote(recheckNote(data.verification ? { status: data.verification.status, reason: checked } : { status: "skipped", reason: data.reason }));
        },
      },
    );
  };

  if (list.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        {slow && <p className="text-[12px] text-gray-500">Checking your site...</p>}
        <SkeletonStats count={4} />
        <SkeletonCard rows={3} />
        <SkeletonCard rows={3} />
      </div>
    );
  }

  if (list.isError) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
        <p className="text-[13px] font-medium">Couldn&apos;t load your findings</p>
        <p className="mt-1 text-[12px]">{list.error.message}</p>
        <button
          type="button"
          onClick={() => list.refetch()}
          disabled={list.isFetching}
          className="mt-3 rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {list.isFetching ? "Retrying..." : "Retry"}
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
          <p className="mt-0.5 text-xs text-gray-500">The most important problems first. Open one to see why it matters and what to do.</p>
        </div>
        <button
          type="button"
          onClick={() => list.refetch()}
          title="Refresh findings"
          aria-label="Refresh findings"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 md:min-h-0 md:min-w-0"
        >
          {list.isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {findingCountStats(counts).map((stat) => (
          <Stat key={stat.key} label={stat.label} value={stat.value} tone={stat.tone} />
        ))}
      </div>
      {counts.awaitingVerification > 0 && (
        <p className="-mt-2 text-xs text-gray-500">
          {counts.awaitingVerification} fixed and waiting for Marlo to re-check. They are not counted above until verified.
        </p>
      )}

      {findings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
          <Check className="mx-auto mb-2 text-emerald-500" size={22} />
          <p className="text-sm font-medium text-gray-800">No findings yet</p>
          <p className="mt-1 text-[12px] text-gray-500">
            Run an SEO audit first. Detected on-page and Lighthouse issues appear here with evidence and recommendations.
          </p>
          {onRunAudit && (
            <button
              type="button"
              onClick={onRunAudit}
              disabled={auditRunning}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
            >
              {auditRunning && <Loader2 size={13} className="animate-spin" />}
              {auditRunning ? "Running audit..." : "Run an SEO audit"}
            </button>
          )}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-ui-border bg-ui-surface">
          {findings.map((finding, index) => (
            <li key={finding.id} className="border-t border-ui-border first:border-t-0">
              <button
                type="button"
                onClick={() => select(finding.id)}
                className="ui-transition flex min-h-11 w-full items-start gap-3 px-3 py-3 text-left hover:bg-ui-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
              >
                <SeverityIcon severity={finding.severity} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-[13px] font-semibold leading-5 text-ui-text">{findingTitle(finding)}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className={`rounded-full border px-1.5 py-0.5 text-xs font-medium ${statusClass(finding.status)}`}>
                      {STATUS_LABEL[finding.status]}
                    </span>
                    <span className="min-w-0 truncate text-xs text-gray-500" title={finding.url ?? undefined}>
                      {pagePath(finding.url)}
                    </span>
                  </span>
                  {vanishedNote(finding) && <span data-testid="finding-vanished" className="mt-1 block text-xs text-gray-500">{vanishedNote(finding)}</span>}
                  {index < 3 && <span className="mt-1 block text-xs text-gray-500">Why it is up here: {explainPriority(finding)}</span>}
                </span>
                <ChevronRight size={14} aria-hidden="true" className="mt-2 shrink-0 text-ui-faint" />
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
              <span className={`rounded-full border px-1.5 py-0.5 text-xs font-semibold uppercase ${severityClass(selected.severity)}`}>
                {selected.severity}
              </span>
              <span className={`rounded-full border px-1.5 py-0.5 text-xs font-medium ${statusClass(selected.status)}`}>
                {STATUS_LABEL[selected.status]}
              </span>
              {selected.url && (
                <a href={selected.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-ui-accent-strong hover:underline">
                  {selected.url}
                </a>
              )}
            </span>
          )
        }
        footer={
          selected && (primary || note || CAN_RECHECK.has(selected.status) || isVanished(selected)) ? (
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
              {(CAN_RECHECK.has(selected.status) || isVanished(selected)) && (
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
              <p
                aria-live="polite"
                data-testid="recheck-note"
                className={`basis-full text-[12px] empty:hidden ${note?.tone === "verified" ? "text-emerald-700" : note?.tone === "failed" ? "text-red-700" : "text-amber-700"}`}
              >
                {note?.text}
              </p>
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
