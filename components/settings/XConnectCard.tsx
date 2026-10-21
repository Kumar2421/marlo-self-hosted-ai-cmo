"use client";

import { useEffect, useState } from "react";
import { Lock, Check, Loader2, ExternalLink } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { FEATURES } from "@/lib/features";

/** Real X (Twitter) posting credential — separate from any LLM key, used
 * only to actually publish threads (lib/domain/x/XAgent.ts's this.client).
 * Stored through the same Vault-backed provider_connections slot as every
 * other BYOK key here (provider_id "x") — replaces the old insecure
 * plaintext ApiIntegrationCard usage, which wrote straight to user_settings.
 *
 * No live validation on connect: this needs an OAuth2 user access token
 * with tweet.write scope, which this app doesn't have an OAuth flow for yet
 * (same limitation self-host already has — pasting a token here is existing
 * behavior, not a new promise, just made secure and available in platform
 * mode too, which it wasn't before). */
export default function XConnectCard() {
  const { show } = useToast();
  const [connected, setConnected] = useState(false);
  const [keyPreview, setKeyPreview] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((data: { connections: { providerId: string; keyPreview: string }[] }) => {
        const conn = data.connections?.find((c) => c.providerId === "x");
        if (conn) {
          setConnected(true);
          setKeyPreview(conn.keyPreview);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function handleConnect() {
    if (tokenInput.trim().length < 20) {
      show("Enter a real OAuth2 access token (tweet.write scope) — this isn't your API key/secret pair.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "x", apiKey: tokenInput.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to connect");
      setConnected(true);
      setKeyPreview(`${tokenInput.trim().slice(0, 4)}••••${tokenInput.trim().slice(-2)}`);
      setTokenInput("");
      show("X connected — threads generated from here can now post for real.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to connect X.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await fetch("/api/providers?providerId=x", { method: "DELETE" });
      setConnected(false);
      setKeyPreview("");
      show("X disconnected.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disconnect X.");
    } finally {
      setBusy(false);
    }
  }

  if (FEATURES.PLATFORM_MODE) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#111111] text-[13px] font-bold text-white">𝕏</span>
          <div>
            <div className="text-[13px] font-semibold text-gray-900">X (Twitter)</div>
            <div className="mt-1 text-[12px] text-gray-500">Posting requires an OAuth connection. Hosted token entry is disabled; OAuth-based X publishing will be enabled here when the platform connection is available.</div>
          </div>
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">OAuth coming soon</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#111111] text-[13px] font-bold text-white">
          𝕏
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate text-[13px] font-semibold text-gray-900">
            X (Twitter)
            {connected && (
              <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">
                <Check size={10} /> Connected
              </span>
            )}
          </div>
          <div className="truncate text-[12px] text-gray-500">Post real tweets and threads</div>
        </div>
        <a
          href="https://developer.x.com/en/portal/dashboard"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700"
        >
          Get token <ExternalLink size={11} />
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
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="OAuth2 access token (tweet.write scope)"
            type="password"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
          />
          <button
            onClick={handleConnect}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Lock size={11} />}
            Connect
          </button>
        </div>
      )}
    </div>
  );
}
