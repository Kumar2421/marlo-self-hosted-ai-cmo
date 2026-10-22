"use client";

import { useEffect, useState } from "react";
import { Loader2, Zap, Lock } from "lucide-react";
import { creditsDisplay } from "@/lib/credits-display";

type UsageEvent = {
  id: string;
  agent_type: string;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  credits_charged: number;
  status: "ok" | "failed" | "refunded";
  created_at: string;
};

type CreditCost = { agent_type: string; credits: number; description: string | null };

type UsageData = {
  available: boolean;
  balance?: number;
  granted?: number;
  planTier?: string;
  billingEnabled?: boolean;
  events?: UsageEvent[];
  costs?: CreditCost[];
};

function formatAgentType(agentType: string): string {
  return agentType
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export default function CreditsPage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ available: false }))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-gray-500">
        <Loader2 size={14} className="animate-spin" /> Loading credits...
      </div>
    );
  }

  if (!data?.available) {
    return (
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-[15px] font-semibold text-gray-900">Credits</h1>
        <p className="mb-4 text-[13px] text-gray-500">
          Not applicable in self-host mode — you bring your own LLM keys, so nothing here is metered or charged.
        </p>
      </div>
    );
  }

  const { balance = 0, granted = 0, billingEnabled = false, events = [], costs = [] } = data;
  // granted is only real once at least one ledger grant exists (new
  // accounts always have the signup grant) — guards divide-by-zero for the
  // rare row that predates the credits system, backfilled with a grant of 0.
  const view = creditsDisplay({ balance, granted, billingEnabled });
  const pctRemaining = granted > 0 ? balance / granted : 1;
  const status = !billingEnabled ? "Beta" : pctRemaining > 0.2 ? "Healthy" : pctRemaining > 0 ? "Low" : "Out";
  const statusColor =
    status === "Out" ? "bg-red-50 text-red-700" : status === "Low" ? "bg-amber-50 text-amber-700" : "bg-[#e6f7f4] text-[#00846f]";

  return (
    <div className="min-w-0 max-w-3xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Credits</h1>
      <p className="mb-4 text-[13px] text-gray-500">Monitor usage and manage tasks for your AI CMO.</p>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Credits used</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold text-gray-900">{view.usedLabel}</span>
              {view.allowanceLabel && <span className="text-[13px] text-gray-400">/ {view.allowanceLabel}</span>}
            </div>
          </div>
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium ${statusColor}`}>
            <Zap size={13} /> {status}
          </span>
        </div>

        {view.barPercent !== null && (
          <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-[#111111]" style={{ width: `${view.barPercent}%` }} />
          </div>
        )}

        <div className="grid grid-cols-2 divide-x divide-gray-100 border-t border-gray-100 pt-3">
          <div>
            <div className="text-[11px] text-gray-400">Credits remaining</div>
            <div className="text-[15px] font-semibold text-gray-900">
              {view.remainingLabel}
            </div>
          </div>
          <div className="pl-4">
            <div className="text-[11px] text-gray-400">Resets</div>
            <div className="text-[15px] font-semibold text-gray-900">No refill</div>
          </div>
        </div>
      </div>

      {!billingEnabled && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">
          <Zap size={14} className="shrink-0 text-gray-400" />
          Beta — every action below is still tracked in real time, none of them charge you yet.
        </div>
      )}

      <h2 className="mb-1 text-[13px] font-semibold text-gray-900">Monthly estimate</h2>
      <p className="mb-3 text-[12px] text-gray-500">Automated monthly tasks — available on paid plans.</p>
      <div className="mb-6 flex items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-[13px] text-gray-400">
        <Lock size={14} className="shrink-0" />
        Per-agent monthly credit estimates land with paid plans — not available during the credits beta.
      </div>

      <h2 className="mb-2 text-[13px] font-semibold text-gray-900">Recent activity</h2>
      {events.length === 0 ? (
        <div className="mb-6 rounded-xl border border-dashed border-gray-200 p-6 text-center text-[13px] text-gray-500">
          No agent actions yet — usage shows up here as you run audits, generate content, and more.
        </div>
      ) : (
        <div className="mb-6 overflow-hidden rounded-xl border border-gray-200">
          <div className="grid grid-cols-[1fr_100px_80px] gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase text-gray-500">
            <span>Action</span>
            <span className="text-right">Credits</span>
            <span className="text-right">When</span>
          </div>
          {events.map((e) => (
            <div key={e.id} className="grid grid-cols-[1fr_100px_80px] gap-2 border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
              <div className="min-w-0">
                <div className="truncate text-gray-800">{formatAgentType(e.agent_type)}</div>
                {e.model && <div className="truncate text-[11px] text-gray-400">{e.model}</div>}
              </div>
              <span className={`text-right font-medium ${e.status === "failed" ? "text-red-500" : "text-gray-900"}`}>
                {e.status === "failed" ? "—" : e.credits_charged}
              </span>
              <span className="text-right text-[11px] text-gray-400">
                {new Date(e.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-2 text-[13px] font-semibold text-gray-900">What things cost</h2>
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="grid grid-cols-[1fr_70px] gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase text-gray-500">
          <span>Action</span>
          <span className="text-right">Credits</span>
        </div>
        {costs.map((c) => (
          <div key={c.agent_type} className="grid grid-cols-[1fr_70px] gap-2 border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
            <div className="min-w-0">
              <div className="text-gray-800">{formatAgentType(c.agent_type)}</div>
              {c.description && <div className="truncate text-[11px] text-gray-400">{c.description}</div>}
            </div>
            <span className="text-right font-medium text-gray-900">{c.credits}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Using your own connected LLM key (Settings → LLM Providers) skips credit charges entirely for that action —
        this pricing only applies to platform-provided models.
      </p>
    </div>
  );
}
