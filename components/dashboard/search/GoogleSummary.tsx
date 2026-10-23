"use client";

import { RECONNECT_TEXT } from "@/lib/domain/integrations/googleHealthView";
import { RECONNECT_IN_TRAFFIC_HINT } from "@/lib/googleOAuthScopes";

type Totals = { clicks: number; impressions: number; ctr: number; position: number };
type Ga4 = { sessions: number; activeUsers: number; screenPageViews: number } | null;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-1 text-[11px] uppercase text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

/** The last 28 days of real Google data, on the SEO tab once a site is chosen. */
export default function GoogleSummary({
  totals,
  ga4,
  loading,
  error,
  showReconnect = false,
  onViewTraffic,
  onRetry,
}: {
  totals: Totals | null;
  ga4: Ga4;
  loading: boolean;
  error: string | null;
  /** The server says Google no longer accepts the saved connection. */
  showReconnect?: boolean;
  onViewTraffic: () => void;
  onRetry: () => void;
}) {
  if (loading && !totals) {
    return (
      <div className="mb-5 grid animate-pulse grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[66px] rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (showReconnect && !totals) {
    return (
      <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
        <span className="min-w-0 break-words">{RECONNECT_TEXT}</span>
        <span className="shrink-0">{RECONNECT_IN_TRAFFIC_HINT}</span>
      </div>
    );
  }

  if (error && !totals) {
    return (
      <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
        <span className="min-w-0 break-words">{error}</span>
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline">
          Retry
        </button>
      </div>
    );
  }

  if (!totals) return null;

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[12px] font-semibold text-gray-700">Last 28 days on Google</h4>
        <button type="button" onClick={onViewTraffic} className="text-[11px] text-blue-600 hover:underline">
          See full traffic →
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Search clicks" value={totals.clicks.toLocaleString()} />
        <Stat label="Search views" value={totals.impressions.toLocaleString()} />
        <Stat label="Avg. position" value={totals.position.toFixed(1)} />
        <Stat label="Visits (GA4)" value={ga4 ? ga4.sessions.toLocaleString() : "—"} />
      </div>
    </section>
  );
}
