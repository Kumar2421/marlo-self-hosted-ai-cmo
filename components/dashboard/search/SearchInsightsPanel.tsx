"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import SidePanel from "@/components/shared/SidePanel";
import { pickHighlights } from "@/lib/domain/search/highlights";
import type { OpportunityGroups, SearchOpportunity } from "@/lib/domain/search/searchOpportunities";
import type { SearchInsights } from "@/lib/domain/search/types";
import { INTENT_LABELS, timeAgo } from "./intentLabels";
import type { SearchOpportunitiesState } from "./useSearchOpportunities";
import { useTrackOpportunity, type OpportunityTracking } from "./useTrackOpportunity";

export type TopQuery = { query: string; clicks: number; impressions: number; ctr: number; position: number };

const TABS = ["Overview", "Opportunities", "Topics", "Queries"] as const;
type Tab = (typeof TABS)[number];

const SECTIONS: Array<{ key: keyof Omit<OpportunityGroups, "changes">; title: string; hint: string }> = [
  { key: "declining", title: "Slipping", hint: "You lost ground on these compared with the previous 28 days." },
  { key: "ctr", title: "Rank well, but few click", hint: "A better title and description could win more of these clicks." },
  { key: "ranking", title: "Closest to page one", hint: "Searches where you already show up, just below the top results." },
  { key: "newQueries", title: "New this month", hint: "People just started finding you for these." },
  { key: "lostQueries", title: "No longer showing", hint: "You had views for these before, and none now." },
];

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : "text-gray-900";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-1 text-xs uppercase text-gray-500">{label}</div>
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function TrackButton({ item, tracking }: { item: SearchOpportunity; tracking: OpportunityTracking }) {
  if (tracking.isTracked(item)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <Check size={11} /> Tracked in Findings
      </span>
    );
  }
  const busy = tracking.pendingKey === tracking.keyOf(item);
  return (
    <button
      type="button"
      onClick={() => tracking.track(item)}
      disabled={busy}
      className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {busy ? "Adding…" : "Track this"}
    </button>
  );
}

function OpportunityItem({ item, tracking }: { item: SearchOpportunity; tracking: OpportunityTracking }) {
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 break-words text-[13px] font-medium text-gray-900">{item.query}</span>
        {item.pageUrl && (
          <a href={item.pageUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-blue-600 hover:underline">
            Open page
          </a>
        )}
      </div>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-gray-600">
        {item.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <div className="mt-2">
        <TrackButton item={item} tracking={tracking} />
      </div>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-[12px] text-gray-500">{children}</div>;
}

function Overview({ groups, tracking }: { groups: OpportunityGroups; tracking: OpportunityTracking }) {
  const highlights = pickHighlights(groups);
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-[12px] font-semibold text-gray-700">What changed in the last 28 days</h3>
        <p className="mb-2 text-xs text-gray-500">Compared with the 28 days before, across your most-viewed searches.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Improved" value={groups.changes.up} tone="good" />
          <Stat label="Slipping" value={groups.changes.down} tone={groups.changes.down > 0 ? "bad" : undefined} />
          <Stat label="New" value={groups.changes.new} />
          <Stat label="No longer showing" value={groups.changes.lost} />
        </div>
      </section>
      <section>
        <h3 className="mb-1 text-[12px] font-semibold text-gray-700">Worth a look first</h3>
        {highlights.length === 0 ? (
          <Empty>Nothing stands out right now. Check back after the next daily update.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white px-4">
            {highlights.map((item) => (
              <OpportunityItem key={`${item.type}:${item.query}`} item={item} tracking={tracking} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Opportunities({ groups, tracking }: { groups: OpportunityGroups; tracking: OpportunityTracking }) {
  const visible = SECTIONS.filter((section) => groups[section.key].length > 0);
  if (visible.length === 0) return <Empty>No opportunities right now. Check back after the next daily update.</Empty>;
  return (
    <div className="space-y-4">
      {visible.map((section) => (
        <section key={section.key} className="rounded-xl border border-gray-200 bg-white px-4 pt-3">
          <h3 className="text-[12px] font-semibold text-gray-700">{section.title}</h3>
          <p className="text-xs text-gray-500">{section.hint}</p>
          <ul className="divide-y divide-gray-100">
            {groups[section.key].map((item) => (
              <OpportunityItem key={`${item.type}:${item.query}`} item={item} tracking={tracking} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Topics({ search }: { search: SearchInsights | null }) {
  if (!search || search.analysedQueries === 0) return <Empty>No search topics yet. Connect Search Console and refresh.</Empty>;
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-[12px] font-semibold text-gray-700">What people are trying to do</h3>
        <p className="mb-3 text-xs text-gray-500">From your top {search.analysedQueries.toLocaleString()} searches.</p>
        <div className="space-y-2.5">
          {search.intents.map((intent) => (
            <div key={intent.intent}>
              <div className="flex justify-between text-[12px] text-gray-700">
                <span>{INTENT_LABELS[intent.intent]}</span>
                <span className="text-gray-500">
                  {Math.round(intent.share * 100)}% · {intent.impressions.toLocaleString()} views
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-gray-800" style={{ width: `${Math.max(intent.share * 100, 2)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-1 text-[12px] font-semibold text-gray-700">Topics people ask about</h3>
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white px-4">
          {search.themes.map((theme) => (
            <li key={theme.label} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words text-[13px] font-medium text-gray-900">{theme.label}</span>
                <span className="shrink-0 text-xs text-gray-500">
                  {theme.impressions.toLocaleString()} views · you rank ~{theme.position.toFixed(1)}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {INTENT_LABELS[theme.intent]}
                {theme.queries > 1 && ` · ${theme.queries} similar searches: ${theme.examples.slice(1).join(", ")}`}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Queries({ queries }: { queries: TopQuery[] }) {
  if (queries.length === 0) return <Empty>No search queries yet.</Empty>;
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <table className="w-full border-collapse text-[12px]">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Search</th>
            <th className="px-3 py-2 text-right font-semibold">Clicks</th>
            <th className="px-3 py-2 text-right font-semibold">Views</th>
            <th className="px-3 py-2 text-right font-semibold">Click rate</th>
            <th className="px-3 py-2 text-right font-semibold">Position</th>
          </tr>
        </thead>
        <tbody>
          {queries.map((q) => (
            <tr key={q.query} className="border-t border-gray-100">
              <td className="px-3 py-2 text-gray-800">{q.query}</td>
              <td className="px-3 py-2 text-right text-gray-700">{q.clicks.toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-gray-700">{q.impressions.toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-gray-700">{(q.ctr * 100).toFixed(1)}%</td>
              <td className="px-3 py-2 text-right text-gray-700">{q.position.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  state: SearchOpportunitiesState;
  search: SearchInsights | null;
  topQueries: TopQuery[];
};

/** Full search insights in a slide-over: the data that is too dense for a dashboard column. */
export default function SearchInsightsPanel({ open, onClose, state, search, topQueries }: Props) {
  const [tab, setTab] = useState<Tab>("Overview");
  const tracking = useTrackOpportunity();

  const toolbar = (
    <div role="tablist" aria-label="Search insights sections" className="flex gap-1">
      {TABS.map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={tab === name}
          onClick={() => setTab(name)}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
            tab === name ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );

  const needsSnapshot = tab === "Overview" || tab === "Opportunities";
  let body: React.ReactNode;
  if (tab === "Topics") body = <Topics search={search} />;
  else if (tab === "Queries") body = <Queries queries={topQueries} />;
  else if (state.status === "loading") body = <Empty>Loading…</Empty>;
  else if (state.status === "error") body = <Empty>Couldn&apos;t load search insights. Try again in a moment.</Empty>;
  else if (state.status === "empty") body = <Empty>No saved search history yet. Close this and use Refresh now to start tracking.</Empty>;
  else body = tab === "Overview" ? <Overview groups={state.opportunities} tracking={tracking} /> : <Opportunities groups={state.opportunities} tracking={tracking} />;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Search insights"
      subtitle={needsSnapshot && state.status === "ready" ? `Updated ${timeAgo(state.capturedAt)}` : "Based on your last 28 days in Google Search"}
      toolbar={toolbar}
    >
      {tracking.error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{tracking.error}</div>}
      {body}
    </SidePanel>
  );
}
