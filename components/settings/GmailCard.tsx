"use client";

import { CREDENTIALS_PATH } from "@/lib/settingsPaths";
import { useEffect, useState } from "react";
import { Check, ExternalLink, AlertTriangle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/client";
import { googleOAuthQueryParams, scopesFor } from "@/lib/googleOAuthScopes";

/** Self-host: two real steps, not one — (1) app-level OAuth Client ID/Secret,
 * written to .env.local, only takes effect after a real server restart
 * (Node reads env at process startup, not per-request); (2) the actual OAuth
 * consent flow, only possible once step 1 is live. This card is honest about
 * which state it's in at every point, never implies "saved" means "active".
 *
 * Platform mode: there is no per-user client ID/secret to enter — the
 * platform operator registers ONE Google Cloud OAuth client and sets
 * GMAIL_CLIENT_ID/SECRET once as a real server env var (not user-editable,
 * and never written to a file — see /api/settings/env's platform-mode
 * guard). Every user just clicks "Connect Gmail" directly. */
export default function GmailCard() {
  const { show } = useToast();
  const searchParams = useSearchParams();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [envActive, setEnvActive] = useState({ GMAIL_CLIENT_ID: false, GMAIL_CLIENT_SECRET: false });
  const [savedButNotActive, setSavedButNotActive] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (FEATURES.PLATFORM_MODE) {
      fetch("/api/auth/gmail/status", { cache: "no-store" })
        .then((r) => r.ok ? r.json() : Promise.reject(new Error("status")))
        .then((data: { email?: string | null }) => {
          setConnectedEmail(data.email ?? null);
        })
        .catch(() => {})
        .finally(() => setLoaded(true));
      return;
    }

    Promise.all([fetch("/api/settings/env").then((r) => r.json()), fetch("/api/settings").then((r) => r.json())])
      .then(([envData, settingsData]: [{ active?: typeof envActive }, { settings?: { key: string; value: string }[] }]) => {
        setEnvActive(envData.active ?? { GMAIL_CLIENT_ID: false, GMAIL_CLIENT_SECRET: false });
        const emailRow = settingsData.settings?.find((s) => s.key === "gmail_email");
        if (emailRow?.value) setConnectedEmail(emailRow.value);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function handleSaveClientCreds() {
    if (!clientId.trim() || !clientSecret.trim()) {
      show("Enter both the Client ID and Client Secret.");
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/settings/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "GMAIL_CLIENT_ID", value: clientId.trim() }),
      });
      await fetch("/api/settings/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "GMAIL_CLIENT_SECRET", value: clientSecret.trim() }),
      });
      setSavedButNotActive(true);
      setClientId("");
      setClientSecret("");
      show("Saved to .env.local — restart the dev server for this to take effect, then reload this page.");
    } catch {
      show("Failed to save Client ID/Secret.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePlatformConnect() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${CREDENTIALS_PATH}`,
        scopes: scopesFor("gmail"),
        queryParams: googleOAuthQueryParams("gmail"),
      },
    });
    if (error) {
      setBusy(false);
      show(error.message);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await fetch("/api/auth/gmail/disconnect", { method: "POST" });
      setConnectedEmail(null);
      show("Gmail disconnected.");
    } catch {
      show("Failed to disconnect Gmail.");
    } finally {
      setBusy(false);
    }
  }

  // GET /api/settings/env reports the real server env state in both modes
  // (only the write/POST path is self-host-only) — platform mode is NOT
  // assumed active here. Deploying without the operator having set
  // GMAIL_CLIENT_ID/SECRET as real Vercel env vars must show as genuinely
  // not-configured, not silently look ready and fail when clicked.
  const clientCredsActive = envActive.GMAIL_CLIENT_ID && envActive.GMAIL_CLIENT_SECRET;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandIcon id="gmail" color="#ea4335" fallback="G" />
          <div>
            <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-gray-900">
              Gmail
              {connectedEmail && (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-gray-500">
              Real send capability for Leads outreach. Hosted users connect through Google sign-in; self-hosters configure their own OAuth client.
            </div>
          </div>
        </div>
        {!FEATURES.PLATFORM_MODE && (
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700"
          >
            Create OAuth client <ExternalLink size={11} />
          </a>
        )}
      </div>

      {!loaded ? null : FEATURES.PLATFORM_MODE ? (
        connectedEmail ? (
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
            <span>{connectedEmail}</span>
            <button onClick={handleDisconnect} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-50">
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-gray-500">
              Connect Gmail through your Google sign-in. No Client ID, Client Secret, or .env configuration is required for hosted users.
            </p>
            <button
              onClick={handlePlatformConnect}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
            >
              {busy ? "Connecting..." : "Connect with Google"}
            </button>
          </div>
        )
      ) : (
        <>
          {!clientCredsActive ? (
            <div className="rounded-lg bg-gray-50 p-3">
              {savedButNotActive && (
                <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  Saved to .env.local, but not active yet — restart the server, then reload this page.
                </div>
              )}
              <p className="mb-2 text-[11px] text-gray-500">
                Redirect URI to register on the OAuth client:{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5">
                  {typeof window !== "undefined" ? window.location.origin : ""}/api/auth/gmail/callback
                </code>
              </p>
              <div className="mb-2 space-y-2">
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400" />
                <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client Secret" type="password" className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400" />
              </div>
              <button onClick={handleSaveClientCreds} disabled={busy} className="rounded-lg bg-[#111111] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50">
                {busy ? "Saving..." : "Save to .env.local"}
              </button>
            </div>
          ) : connectedEmail ? (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
              <span>{connectedEmail}</span>
              <button onClick={handleDisconnect} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-50">
                Disconnect
              </button>
            </div>
          ) : (
            <a href="/api/auth/gmail/connect" className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black">
              Connect Gmail
            </a>
          )}
        </>
      )}
    </div>
  );
}
