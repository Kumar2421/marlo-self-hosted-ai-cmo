"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Plus, XCircle } from "lucide-react";
import type { Action } from "@/lib/domain/actions/actionTypes";
import type { Recommendation } from "@/lib/domain/recommendations/recommendationTypes";
import { implementationOf, type Outcome, type OutcomeStatus } from "@/lib/domain/search/actionOutcome";
import type { ActionWithOutcome } from "@/lib/domain/search/outcomeService";
import { closedPullRequestOf, pullRequestUrlOf } from "@/lib/domain/fixes/linkPullRequest";

/** The linked fix PR while the action is still open: Open, or Closed without merging (shown once, until a new PR is linked). */
function PullRequestState({ action }: { action: Action }) {
  const openUrl = pullRequestUrlOf(action.result);
  const closed = openUrl ? null : closedPullRequestOf(action.result);
  const url = openUrl ?? closed?.url;
  if (!url) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="pr-state">
      <span
        className={
          "rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase " +
          (openUrl ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")
        }
      >
        {openUrl ? "Pull request open" : "Closed without merging"}
      </span>
      <a href={url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline">
        View the pull request
      </a>
    </div>
  );
}

const STATUS_LABEL: Record<Action["status"], string> = {
  proposed: "Proposed",
  approved: "Approved",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<Action["status"], string> = {
  proposed: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-blue-200 bg-blue-50 text-blue-700",
  running: "border-violet-200 bg-violet-50 text-violet-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-gray-200 bg-gray-50 text-gray-500",
};

const OUTCOME_LABEL: Record<OutcomeStatus, string> = {
  waiting: "Waiting for data",
  improved: "Improved",
  unchanged: "No clear change",
  regressed: "Got worse",
  no_data: "Can't measure yet",
  not_applied: "Change not seen",
};

const OUTCOME_CLASS: Record<OutcomeStatus, string> = {
  waiting: "border-blue-200 bg-blue-50 text-blue-700",
  improved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  unchanged: "border-gray-200 bg-gray-50 text-gray-600",
  regressed: "border-red-200 bg-red-50 text-red-700",
  no_data: "border-gray-200 bg-gray-50 text-gray-500",
  not_applied: "border-amber-200 bg-amber-50 text-amber-700",
};

function OutcomeCard({ action, outcome, onUndo, busy }: { action: ActionWithOutcome; outcome: Outcome | null; onUndo: () => void; busy: boolean }) {
  const implementation = implementationOf(action.result);
  if (!implementation) return null;
  const canUndo = action.canUndo;
  const via = implementation.via === "github_pr" ? "via GitHub PR" : implementation.via === "cms_publish" ? "via your CMS" : "by you";
  const prUrl = implementation.change?.prUrl as string | undefined;
  // For a CMS publish or a GitHub PR, "undo" only resets tracking: the change stays on the site.
  const stopTrackingOnly = implementation.via === "cms_publish" || implementation.via === "github_pr";

  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5" data-testid="outcome-card">
      <div className="flex flex-wrap items-center gap-2">
        {outcome && (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${OUTCOME_CLASS[outcome.status]}`}>{OUTCOME_LABEL[outcome.status]}</span>
        )}
        <span className="text-[10px] text-gray-400">
          Made {new Date(implementation.implementedAt).toLocaleDateString()} {via}
        </span>
        {prUrl && (
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-semibold text-blue-700">
            Pull request merged
          </span>
        )}
        {canUndo && (
          <button type="button" onClick={onUndo} disabled={busy} className="ml-auto text-[10px] text-gray-500 hover:text-gray-800 hover:underline disabled:opacity-50">
            {stopTrackingOnly ? "Stop tracking" : "Undo"}
          </button>
        )}
      </div>
      {canUndo && stopTrackingOnly && (
        <p className="mt-1 text-[10px] leading-4 text-gray-400" data-testid="stop-tracking-note">
          This only stops tracking the result. It does not change your site back.
        </p>
      )}
      {outcome && <p className="mt-1.5 text-[12px] leading-5 text-gray-800">{outcome.headline}</p>}
      {outcome?.pageNote && <p className="mt-1 text-[11px] leading-4 text-gray-500">{outcome.pageNote}</p>}
      {prUrl && (
        <a href={prUrl} target="_blank" rel="noreferrer" className="mt-1 block text-[11px] text-blue-600 hover:underline">
          View the pull request
        </a>
      )}
    </div>
  );
}

function ImplementControl({
  action,
  busy,
  onImplement,
}: {
  action: Action;
  busy: boolean;
  onImplement: (action: Action, pageUrl?: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [url, setUrl] = useState(action.target.url ?? "");

  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={() => onImplement(action, custom && url.trim() ? url.trim() : undefined)}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          I made this change
        </button>
        {!custom && (
          <button type="button" onClick={() => setCustom(true)} className="text-[10px] text-gray-500 hover:text-gray-800 hover:underline">
            Changed a different page?
          </button>
        )}
      </div>
      {custom && (
        <label className="mt-2 block">
          <span className="mb-0.5 block text-[10px] text-gray-500">The page you changed (on your website)</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yoursite.com/page"
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
          />
        </label>
      )}
      <p className="mt-1.5 text-[10px] text-gray-400">
        Marlo saves today&apos;s numbers, then checks back after a week or two to show whether it helped.
      </p>
    </div>
  );
}

export default function FindingActionsSection({
  recommendations,
  actions,
  loading,
  busyRecommendationId,
  onCreate,
  onCancel,
  onImplement,
  onUndo,
}: {
  recommendations: Recommendation[];
  actions: ActionWithOutcome[];
  loading: boolean;
  busyRecommendationId: string | null;
  onCreate: (recommendation: Recommendation) => void;
  onCancel: (action: Action) => void;
  onImplement: (action: Action, pageUrl?: string) => void;
  onUndo: (action: Action) => void;
}) {
  const latestByRecommendation = new Map<string, ActionWithOutcome>();
  for (const action of actions) {
    if (!action.recommendationId) continue;
    if (!latestByRecommendation.has(action.recommendationId)) {
      latestByRecommendation.set(action.recommendationId, action);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-500">
        <Loader2 size={13} className="animate-spin" />
        Loading tracked actions...
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-500">
        No recommendations are available to turn into an action.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {recommendations.map((recommendation) => {
        const action = latestByRecommendation.get(recommendation.id);
        const busy = busyRecommendationId === recommendation.id || (action ? busyRecommendationId === action.id : false);

        return (
          <div key={recommendation.id} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-gray-900">{recommendation.title}</div>
                <div className="mt-1 text-[11px] leading-4 text-gray-600">{recommendation.summary}</div>
              </div>
              {action ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[9px] font-semibold uppercase text-gray-500">{recommendation.priority}</span>
                  <span className={"rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase " + STATUS_CLASS[action.status]}>
                    {STATUS_LABEL[action.status]}
                  </span>
                </span>
              ) : (
                <button
                  onClick={() => onCreate(recommendation)}
                  disabled={busy}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-[#111111] px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-black disabled:opacity-50"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Track action
                </button>
              )}
            </div>

            <div className="mt-2 whitespace-pre-line text-[11px] leading-4 text-gray-500">
              <span className="font-medium text-gray-700">{recommendation.implementation.kind}</span>
              {" · "}
              {recommendation.implementation.description}
            </div>

            {action?.status === "approved" && action.parameters?.autoApproved === true && (
              <div className="mt-2 text-[10px] font-medium text-blue-700" data-testid="auto-approved-note">
                Auto-approved by Marlo (a safe fix: nothing changes on your site until you act)
              </div>
            )}

            {action && (action.status === "proposed" || action.status === "approved") && (
              <>
                <PullRequestState action={action} />
                <ImplementControl key={action.id} action={action} busy={busy} onImplement={onImplement} />
                <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                  <span className="text-[10px] text-gray-400">Saved as a tracked action. Nothing is changed on your site for you.</span>
                  <button
                    onClick={() => onCancel(action)}
                    disabled={busy}
                    className="flex items-center gap-1 text-[10px] font-medium text-gray-500 hover:text-red-600 disabled:opacity-50"
                  >
                    <XCircle size={11} />
                    Cancel
                  </button>
                </div>
              </>
            )}

            {action?.status === "completed" && <OutcomeCard action={action} outcome={action.outcome} onUndo={() => onUndo(action)} busy={busy} />}

            {action && action.status !== "proposed" && action.status !== "approved" && action.status !== "completed" && (
              <div className="mt-2 border-t border-gray-100 pt-2 text-[10px] text-gray-400">
                Action created {new Date(action.createdAt).toLocaleString()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
