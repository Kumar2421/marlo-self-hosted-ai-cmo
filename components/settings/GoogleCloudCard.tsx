"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ExternalLink, Sparkles } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";
import { FEATURES } from "@/lib/features";

/** One Google Cloud API key unlocks 3 real features that all use plain
 * API-key auth (no OAuth): Places API (Leads → Local Business mode),
 * Custom Search JSON API (extra Leads search source), Knowledge Graph
 * Search API (Competitor Analysis enrichment). Custom Search additionally
 * needs a Programmable Search Engine ID (cx) — a separate real setup step
 * at programmablesearchengine.google.com, not just an API key. */
export default function GoogleCloudCard() {
  const { show } = useToast();
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [keyPreview, setKeyPreview] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [cx, setCx] = useState("");
  const [savedCx, setSavedCx] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [gcpConnectedEmail, setGcpConnectedEmail] = useState<string | null>(null);
  const [gcpProjectId, setGcpProjectId] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);

  useEffect(() => {
    const error = searchParams.get("gcp_error");
    if (error) show(`Google Cloud connect failed: ${error}`);
  }, [searchParams, show]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings: { key: string; value: string }[] }) => {
        const keyRow = data.settings?.find((s) => s.key === "google_cloud_api_key");
        if (keyRow?.value) {
          setConnected(true);
          setKeyPreview(keyRow.value); // already masked server-side — never send the real key to the browser
        }
        const cxRow = data.settings?.find((s) => s.key === "google_cse_id");
        if (cxRow?.value) {
          setSavedCx(cxRow.value);
          setCx(cxRow.value);
        }
        const gcpEmailRow = data.settings?.find((s) => s.key === "gcp_email");
        if (gcpEmailRow?.value) setGcpConnectedEmail(gcpEmailRow.value);
        const gcpProjectRow = data.settings?.find((s) => s.key === "gcp_project_id");
        if (gcpProjectRow?.value) setGcpProjectId(gcpProjectRow.value);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function handleCreateKey() {
    if (!gcpProjectId.trim()) {
      show("Enter your Google Cloud project id first.");
      return;
    }
    setCreatingKey(true);
    try {
      const res = await fetch("/api/settings/google-cloud/create-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gcpProjectId: gcpProjectId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(data.error || "Failed to create API key.");
        return;
      }
      setConnected(true);
      setKeyPreview(data.keyPreview);
      show("Created a real API key, restricted to Places, Custom Search, and Knowledge Graph — saved.");
    } catch {
      show("Failed to create API key.");
    } finally {
      setCreatingKey(false);
    }
  }

  async function handleGcpDisconnect() {
    setBusy(true);
    try {
      await fetch("/api/auth/google-cloud/disconnect", { method: "POST" });
      setGcpConnectedEmail(null);
      show("Google Cloud account disconnected.");
    } catch {
      show("Failed to disconnect.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSetting(key: string, value: string) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save");
  }

  async function handleConnect() {
    if (!keyInput.trim()) {
      show("Enter a Google Cloud API key first.");
      return;
    }
    setBusy(true);
    try {
      await saveSetting("google_cloud_api_key", keyInput.trim());
      setConnected(true);
      setKeyPreview(`${keyInput.trim().slice(0, 4)}••••${keyInput.trim().slice(-2)}`);
      setKeyInput("");
      show("Google Cloud connected — Places, Custom Search, and Knowledge Graph are live.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to connect Google Cloud.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await saveSetting("google_cloud_api_key", "");
      setConnected(false);
      setKeyPreview("");
      show("Google Cloud disconnected.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disconnect Google Cloud.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCx() {
    setBusy(true);
    try {
      await saveSetting("google_cse_id", cx.trim());
      setSavedCx(cx.trim());
      show(cx.trim() ? "Search Engine ID saved." : "Search Engine ID cleared.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save Search Engine ID.");
    } finally {
      setBusy(false);
    }
  }

  if (FEATURES.PLATFORM_MODE) {
    return (
      <div className="rounded-xl border border-ui-border bg-ui-surface p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <BrandIcon id="google-cloud" color="#4285f4" fallback="G" />
          <div>
            <div className="text-[13px] font-semibold text-ui-text">Google Cloud Services</div>
            <div className="mt-1 text-[12px] text-ui-muted">Places, Custom Search, and Knowledge Graph access are managed by the hosted platform. No Google Cloud API key or project configuration is required.</div>
          </div>
          <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-ui-accent-soft px-2 py-0.5 text-xs font-medium text-ui-accent-strong">Managed by Marlo</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ui-border bg-ui-surface p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandIcon id="google-cloud" color="#4285f4" fallback="G" />
          <div>
            <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-ui-text">
              Google Cloud API Key
              {connected && (
                <span className="flex items-center gap-1 rounded-full bg-ui-success-soft px-2 py-0.5 text-xs font-medium text-ui-success-text">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-ui-muted">
              Enable Places API, Custom Search API, and Knowledge Graph Search API on this key in Cloud
              Console. Powers Leads → Local Business search, an extra Leads search source, and real
              Competitor Analysis enrichment.
            </div>
          </div>
        </div>
        <a
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-ui-subtle hover:text-ui-text"
        >
          Get key <ExternalLink size={11} />
        </a>
      </div>

      {!loaded ? null : connected ? (
        <div className="flex items-center justify-between rounded-lg bg-ui-surface-muted px-3 py-2 text-[12px] text-ui-muted">
          <span className="min-w-0 break-all font-mono">{keyPreview}</span>
          <button onClick={handleDisconnect} disabled={busy} className="font-medium text-ui-danger-text hover:underline disabled:opacity-50">
            Disconnect
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="AIza..."
            type="password"
            className="min-w-0 flex-1 min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint"
          />
          <button
            onClick={handleConnect}
            disabled={busy}
            className="shrink-0 rounded-lg bg-ui-primary min-h-11 px-3.5 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface font-medium text-ui-inverse hover:bg-ui-primary-hover disabled:opacity-50"
          >
            {busy ? "Connecting..." : "Connect"}
          </button>
        </div>
      )}

      {!loaded ? null : !connected && (
        <div className="mt-3 rounded-lg border border-dashed border-ui-border p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ui-muted">
            <Sparkles size={12} className="text-ui-faint" /> Or create one automatically
          </div>
          <p className="mb-2 text-xs text-ui-muted">
            Connects your Google account with the Cloud Platform scope (broad — full access to whatever
            project you point it at, not narrower to just API keys; that&apos;s Google&apos;s API, not
            ours), then creates a real key on your project, restricted to exactly Places, Custom Search,
            and Knowledge Graph — nothing else.
          </p>

          {!gcpConnectedEmail ? (
            <a
              href="/api/auth/google-cloud/connect"
              className="inline-flex items-center gap-1.5 rounded-lg bg-ui-primary min-h-11 px-3.5 py-2 text-[12px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface font-medium text-ui-inverse hover:bg-ui-primary-hover"
            >
              Connect Google account
            </a>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[12px] text-ui-muted">
                <span>{gcpConnectedEmail}</span>
                <button onClick={handleGcpDisconnect} disabled={busy} className="font-medium text-ui-danger-text hover:underline disabled:opacity-50">
                  Disconnect
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  value={gcpProjectId}
                  onChange={(e) => setGcpProjectId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
                  placeholder="your-gcp-project-id"
                  className="min-w-0 flex-1 min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint"
                />
                <button
                  onClick={handleCreateKey}
                  disabled={creatingKey}
                  className="shrink-0 rounded-lg bg-ui-primary min-h-11 px-3.5 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface font-medium text-ui-inverse hover:bg-ui-primary-hover disabled:opacity-50"
                >
                  {creatingKey ? "Creating..." : "Create key"}
                </button>
              </div>
              <p className="text-xs text-ui-subtle">
                An existing Google Cloud project — this doesn&apos;t create the project itself, only the key on it.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-ui-border pt-3">
        <div className="mb-1 flex items-center justify-between text-[12px]">
          <span className="font-medium text-ui-muted">Programmable Search Engine ID (cx)</span>
          <a
            href="https://programmablesearchengine.google.com/controlpanel/all"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-ui-subtle hover:text-ui-text"
          >
            Create one <ExternalLink size={10} />
          </a>
        </div>
        <p className="mb-2 text-xs text-ui-muted">
          Required separately for Custom Search — set it to search the entire web, not one site.
        </p>
        <div className="flex gap-2">
          <input
            value={cx}
            onChange={(e) => setCx(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveCx()}
            placeholder="e.g. a1b2c3d4e5f6g7h8i"
            className="min-w-0 flex-1 min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint"
          />
          <button
            onClick={handleSaveCx}
            disabled={busy || cx === savedCx}
            className="shrink-0 min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 font-medium text-ui-muted hover:bg-ui-surface-sunken disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
