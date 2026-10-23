"use client";

import { useState } from "react";
import { Check, ExternalLink, Sparkles, AlertTriangle } from "lucide-react";
import type { Provider } from "@/lib/mock-providers";
import { useProviders } from "@/lib/providers-store";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";
import { FEATURES } from "@/lib/features";

export default function ProviderCard({ provider }: { provider: Provider }) {
  const { state, connect, disconnect, primaryModel, setPrimaryModel, platformProviders } = useProviders();
  const { show } = useToast();
  const [keyInput, setKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState(provider.baseUrlPlaceholder ?? "");

  const connection = state[provider.id];
  const isConnected = !!connection?.connected;
  const needsKey = provider.requiresKey !== false;
  const needsBaseUrl = !!provider.requiresBaseUrl;
  // Included with the hosted plan (platform operator set a real
  // GROQ_API_KEY/MISTRAL_API_KEY env var) — the user never sees or pastes a
  // key for this provider unless they want to override it with their own.
  // Same honesty pattern as GmailCard: only shown once the operator has
  // actually configured it, never assumed.
  const isPlatformIncluded = platformProviders.includes(provider.id) && !isConnected;
  // LM Studio and Ollama are inherently local — they only ever describe "a
  // server running on this machine" (see mock-providers.ts's own copy:
  // "no key needed, just a host URL"). In self-host mode that's the same
  // machine the browser is on — a real connection. In hosted/platform mode
  // the request runs on Vercel's servers instead, so "http://localhost:1234"
  // resolves to the SERVER's own loopback, never the user's laptop — always
  // fails. Block these two specifically in platform mode; "custom" is left
  // alone since a hosted BYOK user can legitimately point it at their own
  // real remote OpenAI-compatible endpoint, not just localhost.
  const blockedInPlatformMode = FEATURES.PLATFORM_MODE && (provider.id === "lmstudio" || provider.id === "ollama");

  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    if (needsKey && !keyInput.trim()) {
      show("Enter an API key first.");
      return;
    }
    if (needsBaseUrl && !baseUrlInput.trim()) {
      show("Enter a base URL first.");
      return;
    }
    setBusy(true);
    try {
      await connect(provider.id, keyInput.trim(), needsBaseUrl ? baseUrlInput.trim() : undefined);
      show(`${provider.name} connected.`);
      setKeyInput("");
    } catch (err) {
      show(err instanceof Error ? err.message : `Failed to connect ${provider.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await disconnect(provider.id);
      show(`${provider.name} disconnected.`);
    } catch (err) {
      show(err instanceof Error ? err.message : `Failed to disconnect ${provider.name}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-ui-border bg-ui-surface p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandIcon id={provider.id} color={provider.color} fallback={provider.icon} size={19} />

          <div>
            <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-ui-text">
              {provider.name}
              {isConnected && (
                <span className="flex items-center gap-1 rounded-full bg-ui-success-soft px-2 py-0.5 text-xs font-medium text-ui-success-text">
                  <Check size={10} /> Connected
                </span>
              )}
              {isPlatformIncluded && (
                <span className="flex items-center gap-1 rounded-full bg-ui-info-soft px-2 py-0.5 text-xs font-medium text-ui-info-text">
                  <Sparkles size={10} /> Included with your plan
                </span>
              )}
            </div>
            <div className="text-[12px] text-ui-muted">{provider.desc}</div>
          </div>
        </div>
        {provider.docsUrl && (
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-ui-subtle hover:text-ui-text"
          >
            Get key <ExternalLink size={11} />
          </a>
        )}
      </div>

      {isConnected ? (
        <div className="space-y-3">
          <div className="space-y-1.5 rounded-lg bg-ui-surface-muted px-3 py-2 text-[12px] text-ui-muted">
            {connection.baseUrl && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-ui-subtle">Endpoint</span>
                <span className="min-w-0 break-all font-mono">{connection.baseUrl}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 break-all font-mono">
                {/* apiKey already holds the server's masked keyPreview after reconcile, or the raw
                    value briefly right after connect() before the next server round-trip — mask
                    defensively either way so a raw key is never left rendered unmasked. Empty
                    string means "no key needed" for local servers. */}
                {connection.apiKey
                  ? connection.apiKey.includes("•")
                    ? connection.apiKey
                    : `${connection.apiKey.slice(0, 4)}••••${connection.apiKey.slice(-2)}`
                  : "No API key required"}
              </span>
              <button onClick={handleDisconnect} disabled={busy} className="font-medium text-ui-danger-text hover:underline disabled:opacity-50">
                Disconnect
              </button>
            </div>
          </div>
          <ModelPicker provider={provider} primaryModel={primaryModel} onPick={setPrimaryModel} show={show} />
        </div>
      ) : isPlatformIncluded ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-ui-surface-muted px-3 py-2 text-[12px] text-ui-muted">
            Ready to use — no key needed. The platform provides this model for every hosted account.
          </div>
          <ModelPicker provider={provider} primaryModel={primaryModel} onPick={setPrimaryModel} show={show} />
          <details className="text-xs text-ui-subtle">
            <summary className="cursor-pointer hover:text-ui-muted">Use your own key instead</summary>
            <div className="mt-2 flex gap-2">
              <input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder={provider.keyPlaceholder}
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
          </details>
        </div>
      ) : blockedInPlatformMode ? (
        <div className="flex items-start gap-2 rounded-lg border border-ui-warn/30 bg-ui-warn-soft px-2.5 py-2 text-xs text-ui-warn-text">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {provider.name} only runs on your own machine — not reachable from a hosted deployment. Available in
          self-host mode only.
        </div>
      ) : (
        <div className="space-y-2">
          {needsBaseUrl && (
            <input
              value={baseUrlInput}
              onChange={(e) => setBaseUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !needsKey && handleConnect()}
              placeholder={provider.baseUrlPlaceholder || "http://localhost:1234/v1"}
              className="min-w-0 w-full min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint"
            />
          )}
          <div className="flex gap-2">
            {needsKey && (
              <input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder={provider.keyPlaceholder || "API key (optional)"}
                type="password"
                className="min-w-0 flex-1 min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint"
              />
            )}
            <button
              onClick={handleConnect}
              disabled={busy}
              className={`shrink-0 rounded-lg bg-ui-primary min-h-11 px-3.5 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface font-medium text-ui-inverse hover:bg-ui-primary-hover disabled:opacity-50 ${
                needsKey ? "" : "w-full"
              }`}
            >
              {busy ? "Connecting..." : "Connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelPicker({
  provider,
  primaryModel,
  onPick,
  show,
}: {
  provider: Provider;
  primaryModel: string | null;
  onPick: (model: string) => void;
  show: (msg: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-ui-muted">Models (the starred one is your preferred model)</div>
      <div className="flex flex-wrap gap-1.5">
        {provider.models.map((m) => (
          <button
            key={m}
            onClick={() => {
              onPick(m);
              show(`${m} set as your preferred model.`);
            }}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              primaryModel === m
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-ui-border text-ui-muted hover:bg-ui-surface-sunken"
            }`}
          >
            {primaryModel === m && "★ "}
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}
