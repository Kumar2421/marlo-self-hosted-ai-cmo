"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { FEATURES } from "@/lib/features";
import BrandIcon from "@/components/settings/BrandIcon";

export default function PageSpeedCard() {
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
        const row = data.settings?.find((s) => s.key === "pagespeed_api_key");
        if (row?.value) {
          setConnected(true);
          setKeyPreview(row.value); // already masked server-side — never send the real key to the browser
        }
      })
      .catch(() => {
        // settings unreachable — leave as not-connected, audit route falls back to mock anyway
      })
      .finally(() => setLoaded(true));
  }, []);

  async function handleConnect() {
    if (!keyInput.trim()) {
      show("Enter a PageSpeed API key first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "pagespeed_api_key", value: keyInput.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save key");
      setConnected(true);
      setKeyPreview(`${keyInput.trim().slice(0, 4)}••••${keyInput.trim().slice(-2)}`);
      setKeyInput("");
      show("PageSpeed Insights connected — SEO audits will use real Lighthouse data now.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to connect PageSpeed.");
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
        body: JSON.stringify({ key: "pagespeed_api_key", value: "" }),
      });
      if (!res.ok) throw new Error("Failed to disconnect");
      setConnected(false);
      setKeyPreview("");
      show("PageSpeed Insights disconnected — audits will fall back to estimated placeholder scores.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disconnect PageSpeed.");
    } finally {
      setBusy(false);
    }
  }

  if (FEATURES.PLATFORM_MODE) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <BrandIcon id="lighthouse" color="#f44b21" fallback="G" />
          <div>
            <div className="text-[13px] font-semibold text-gray-900">Google PageSpeed Insights</div>
            <div className="mt-1 text-[12px] text-gray-500">Lighthouse and Core Web Vitals are provided by the hosted platform and managed by Marlo. No API key is required.</div>
          </div>
          <span className="ml-auto rounded-full bg-[#e6f7f4] px-2 py-0.5 text-xs font-medium text-ui-accent-strong">Managed by Marlo</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandIcon id="lighthouse" color="#f44b21" fallback="G" />
          <div>
            <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-gray-900">
              Google PageSpeed Insights API
              {connected && (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-xs font-medium text-ui-accent-strong">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-gray-500">
              Fetch real Core Web Vitals and Lighthouse scores for SEO audits. Without
              this, audits show clearly-labeled estimated placeholder scores instead.
            </div>
          </div>
        </div>
        <a
          href="https://developers.google.com/speed/docs/insights/v5/get-started"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-ui-subtle hover:text-gray-700"
        >
          Get key <ExternalLink size={11} />
        </a>
      </div>

      {!loaded ? null : connected ? (
        <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          <span className="min-w-0 break-all font-mono">{keyPreview}</span>
          <button onClick={handleDisconnect} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-50">
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
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
          />
          <button
            onClick={handleConnect}
            disabled={busy}
            className="shrink-0 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {busy ? "Connecting..." : "Connect"}
          </button>
        </div>
      )}
    </div>
  );
}
