"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { FEATURES } from "@/lib/features";

export default function TavilyCard() {
  const { show } = useToast();
  const [connected, setConnected] = useState(false);
  const [keyPreview, setKeyPreview] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings: { key: string; value: string }[] }) => {
        const row = data.settings?.find((s) => s.key === "tavily_api_key");
        if (row?.value) {
          setConnected(true);
          setKeyPreview(row.value); // already masked server-side — never send the real key to the browser
        }
      })
      .catch(() => {
        // settings unreachable — leave as not-connected, generators fall back to crawl-only
      })
      .finally(() => setLoaded(true));
  }, []);

  async function handleConnect() {
    if (!keyInput.trim()) {
      show("Enter a Tavily API key first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "tavily_api_key", value: keyInput.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save key");
      setConnected(true);
      setKeyPreview(`${keyInput.trim().slice(0, 4)}••••${keyInput.trim().slice(-2)}`);
      setKeyInput("");
      show("Tavily connected — Competitor Analysis and Content Strategy can now research the live web.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to connect Tavily.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "tavily_api_key", value: "" }),
      });
      if (!res.ok) throw new Error("Failed to disconnect");
      setConnected(false);
      setKeyPreview("");
      show("Tavily disconnected — those documents will fall back to crawl-only analysis.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disconnect Tavily.");
    } finally {
      setBusy(false);
    }
  }

  if (FEATURES.PLATFORM_MODE) {
    return (
      <div className="rounded-xl border border-ui-border bg-ui-surface p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0f8a7e] text-[13px] font-bold text-white">T</span>
          <div>
            <div className="text-[13px] font-semibold text-ui-text">Tavily Web Search</div>
            <div className="mt-1 text-[12px] text-ui-muted">Live web research is included in the hosted platform and managed by Marlo. No API key is required.</div>
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
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0f8a7e] text-[13px] font-bold text-white">
            T
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-ui-text">
              Tavily Web Search
              {connected && (
                <span className="flex items-center gap-1 rounded-full bg-ui-success-soft px-2 py-0.5 text-xs font-medium text-ui-success-text">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-ui-muted">
              Gives agents a real web_search tool — used by Competitor Analysis and Content
              Strategy to research current competitor info and topic trends instead of relying
              only on crawled page text. Applies globally, across every project. Without a key,
              those two documents still generate — just from crawled data only.
            </div>
          </div>
        </div>
        <a
          href="https://app.tavily.com"
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
            placeholder="tvly-..."
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
    </div>
  );
}
