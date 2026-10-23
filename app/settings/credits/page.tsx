"use client";

import { Zap, Lock } from "lucide-react";
import { creditsDisplay, creditsStatus } from "@/lib/credits-display";
import { PlanBadge } from "@/components/plan/PlanBadge";
import { SkeletonCard } from "@/components/shared/Skeleton";
import { usePlan } from "@/components/plan/usePlan";
import { useUsage } from "@/lib/query/useUsage";
import { CARD, CARD_DASHED, SettingsPageHeader } from "@/components/settings/ui";

function formatAgentType(agentType: string): string {
  return agentType
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export default function CreditsPage() {
  // Start the plan request now, in parallel with usage; PlanBadge shares this query.
  usePlan();
  const { data, isPending, isError } = useUsage();

  if (isPending) {
    return (
      <div className="min-w-0 max-w-3xl">
        <SettingsPageHeader title="Credits" caption="Monitor usage and manage tasks for your AI CMO." />
        <SkeletonCard rows={4} />
      </div>
    );
  }

  if (isError || !data?.available) {
    return (
      <div className="min-w-0 max-w-3xl">
        <SettingsPageHeader
          title="Credits"
          caption="Not applicable in self-host mode — you bring your own LLM keys, so nothing here is metered or charged."
        />
      </div>
    );
  }

  const { balance = 0, granted = 0, billingEnabled = false, events = [], costs = [] } = data;
  // granted is only real once at least one ledger grant exists (new
  // accounts always have the signup grant) — guards divide-by-zero for the
  // rare row that predates the credits system, backfilled with a grant of 0.
  const view = creditsDisplay({ balance, granted, billingEnabled });
  const status = creditsStatus({ balance, granted, billingEnabled });
  const statusColor =
    status === "Out"
      ? "bg-ui-danger-soft text-ui-danger-text"
      : status === "Low"
        ? "bg-ui-warn-soft text-ui-warn-text"
        : "bg-ui-accent-soft text-ui-accent-strong";

  return (
    <div className="min-w-0 max-w-3xl">
      <SettingsPageHeader title="Credits" caption="Monitor usage and manage tasks for your AI CMO." />
      <div className="mb-4 empty:hidden">
        <PlanBadge />
      </div>

      <div className={`${CARD} mb-6 p-5`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-ui-subtle">Credits used</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold text-ui-text">{view.usedLabel}</span>
              {view.allowanceLabel && <span className="text-[13px] text-ui-subtle">/ {view.allowanceLabel}</span>}
            </div>
          </div>
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium ${statusColor}`}>
            <Zap size={13} /> {status}
          </span>
        </div>

        {view.barPercent !== null && (
          <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-ui-surface-sunken">
            <div className="h-full rounded-full bg-ui-primary" style={{ width: `${view.barPercent}%` }} />
          </div>
        )}

        <div className="grid grid-cols-2 divide-x divide-ui-border border-t border-ui-border pt-3">
          <div>
            <div className="text-xs text-ui-subtle">Credits remaining</div>
            <div className="text-[15px] font-semibold text-ui-text">
              {view.remainingLabel}
            </div>
          </div>
          <div className="pl-4">
            <div className="text-xs text-ui-subtle">Resets</div>
            <div className="text-[15px] font-semibold text-ui-text">No refill</div>
          </div>
        </div>
      </div>

      {!billingEnabled && (
        <div className="mb-8 flex items-center gap-2.5 rounded-xl border border-ui-warn/30 bg-ui-warn-soft px-4 py-3 text-[13px] text-ui-warn-text">
          <Zap size={14} className="shrink-0" aria-hidden="true" />
          Beta — every action below is still tracked in real time, none of them charge you yet.
        </div>
      )}

      <h2 className="mb-1 text-[15px] font-semibold text-ui-text">Monthly estimate</h2>
      <p className="mb-3 text-[13px] text-ui-muted">Automated monthly tasks — available on paid plans.</p>
      <div className={`${CARD_DASHED} mb-8 flex items-center gap-2 px-4 py-6 text-[13px] text-ui-subtle`}>
        <Lock size={14} className="shrink-0" />
        Per-agent monthly credit estimates land with paid plans — not available during the credits beta.
      </div>

      <h2 className="mb-3 text-[15px] font-semibold text-ui-text">Recent activity</h2>
      {events.length === 0 ? (
        <div className={`${CARD_DASHED} mb-8 p-6 text-center text-[13px] text-ui-muted`}>
          No agent actions yet — usage shows up here as you run audits, generate content, and more.
        </div>
      ) : (
        <div className={`${CARD} mb-8 overflow-hidden`}>
          <div className="grid grid-cols-[1fr_100px_80px] gap-2 border-b border-ui-border bg-ui-surface-muted px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ui-muted">
            <span>Action</span>
            <span className="text-right">Credits</span>
            <span className="text-right">When</span>
          </div>
          {events.map((e) => (
            <div key={e.id} className="grid grid-cols-[1fr_100px_80px] gap-2 border-t border-ui-border px-4 py-3 text-[13px] first:border-t-0">
              <div className="min-w-0">
                <div className="truncate text-ui-text">{formatAgentType(e.agent_type)}</div>
                {e.model && <div className="truncate text-xs text-ui-subtle">{e.model}</div>}
              </div>
              <span className={`text-right font-medium ${e.status === "failed" ? "text-ui-danger-text" : "text-ui-text"}`}>
                {e.status === "failed" ? "—" : e.credits_charged}
              </span>
              <span className="text-right text-xs text-ui-subtle">
                {new Date(e.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-3 text-[15px] font-semibold text-ui-text">What things cost</h2>
      <div className={`${CARD} overflow-hidden`}>
        <div className="grid grid-cols-[1fr_70px] gap-2 border-b border-ui-border bg-ui-surface-muted px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ui-muted">
          <span>Action</span>
          <span className="text-right">Credits</span>
        </div>
        {costs.map((c) => (
          <div key={c.agent_type} className="grid grid-cols-[1fr_70px] gap-2 border-t border-ui-border px-4 py-3 text-[13px] first:border-t-0">
            <div className="min-w-0">
              <div className="text-ui-text">{formatAgentType(c.agent_type)}</div>
              {c.description && <div className="truncate text-xs text-ui-subtle">{c.description}</div>}
            </div>
            <span className="text-right font-medium text-ui-text">{c.credits}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-ui-subtle">
        Using your own connected LLM key (Settings → LLM Providers) skips credit charges entirely for that action —
        this pricing only applies to platform-provided models.
      </p>
    </div>
  );
}
