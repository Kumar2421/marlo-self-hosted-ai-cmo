"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useOauthBusy } from "@/components/shared/useOauthBusy";
import { CREDENTIALS_PATH } from "@/lib/settingsPaths";
import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";
import { useProject } from "@/lib/project-store";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/client";
import { googleOAuthQueryParams, scopesFor } from "@/lib/googleOAuthScopes";
import { useGoogleConnection } from "@/lib/query/useGoogleConnection";
import GoogleReconnectLink from "@/components/settings/GoogleReconnectLink";

type Resource = { resourceId: string; resourceName: string; selected: boolean };
type IntegrationResources = {
  integrationType: "google-search-console" | "google-analytics";
  integrationId: string | null;
  resources: Resource[];
};

/** Self-host: real GA4 + Search Console OAuth, gated on the same
 * GMAIL_CLIENT_ID/SECRET app config as the Gmail card.
 *
 * Platform mode: same platform-owned client (see GmailCard.tsx's doc
 * comment) — no per-user entry, so the env-active gate is skipped
 * entirely and the card goes straight to Connect/Connected. Most platform
 * users are already connected via "Sign in with Google" at login (which
 * grants these same scopes up front); this card is the manual fallback,
 * and also where a GA4/GSC property gets *selected* when the account has
 * more than one — same resource-picker flow as self-host, since
 * /api/project/integrations/google/resources handles both modes. */
export default function GoogleAnalyticsCard() {
  const { show } = useToast();
  const searchParams = useSearchParams();
  const { project } = useProject();
  const [resources, setResources] = useState<IntegrationResources[]>([]);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useOauthBusy();
  const [loaded, setLoaded] = useState(false);
  const health = useGoogleConnection(project?.id);

  async function load() {
    try {
      const resourceData = await fetch("/api/project/integrations/google/resources", { cache: "no-store" }).then((r) => r.json());
      setResources(resourceData.integrations ?? []);
    } catch {
      // Keep the card usable if the backend is temporarily unavailable.
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    const error = searchParams.get("ga_error");
    if (error) show(`Google Analytics connect failed: ${error}`);
  }, [searchParams, show]);

  useEffect(() => {
    if (project) load();
    else setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  async function handlePlatformConnect() {
    setConnecting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${CREDENTIALS_PATH}`,
        scopes: scopesFor("google-data"),
        queryParams: googleOAuthQueryParams("google-data"),
      },
    });
    if (error) {
      setConnecting(false);
      show(error.message);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/google-analytics/disconnect", { method: "POST" });
      if (!res.ok) throw new Error();
      await load();
      show("Google Analytics / Search Console disconnected from this project.");
    } catch {
      show("Failed to disconnect Google.");
    } finally {
      setBusy(false);
    }
  }

  const gsc = resources.find((r) => r.integrationType === "google-search-console");
  const ga4 = resources.find((r) => r.integrationType === "google-analytics");
  const connected = Boolean(gsc?.integrationId || ga4?.integrationId);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex shrink-0 -space-x-1.5">
            <BrandIcon id="google-analytics" color="#f9ab00" fallback="A" className="flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-bold text-white ring-2 ring-white" size={15} />
            <BrandIcon id="search-console" color="#458cf5" fallback="S" className="flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-bold text-white ring-2 ring-white" size={15} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-gray-900">
              Google Analytics &amp; Search Console
              {connected && health.state === "needs_reconnect" && health.badge && (
                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  <AlertTriangle size={10} /> {health.badge.label}
                </span>
              )}
              {connected && health.state !== "needs_reconnect" && (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-xs font-medium text-ui-accent-strong">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-gray-500">
              Powers the Traffic tab for the currently selected project.
            </div>
          </div>
        </div>
      </div>

      {!project ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Select or create a project before connecting Google.
        </div>
      ) : !loaded ? null : connected ? (
        <div className="space-y-3">
          {health.showReconnect && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <span className="min-w-0">{health.message}</span>
              <GoogleReconnectLink returnTo="settings" />
            </div>
          )}
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
            {[gsc, ga4].map((i) => i?.resources.find((r) => r.selected)?.resourceName).filter(Boolean).join(" · ") ||
              "No site or property chosen yet."}{" "}
            Choose which Search Console site and Analytics property this project uses from the{" "}
            <a href="/dashboard" className="font-medium text-gray-900 underline">SEO tab</a>.
          </div>
          <button onClick={handleDisconnect} disabled={busy} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">
            Disconnect Google from this project
          </button>
        </div>
      ) : FEATURES.PLATFORM_MODE ? (
        <button
          onClick={handlePlatformConnect}
          disabled={busy || connecting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {busy || connecting ? "Connecting..." : "Connect Google"}
        </button>
      ) : (
        <a
          href="/api/auth/google-analytics/connect"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black"
        >
          Connect Google Analytics
        </a>
      )}
    </div>
  );
}
