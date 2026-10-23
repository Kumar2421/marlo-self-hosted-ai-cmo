"use client";

import { useState } from "react";
import { Check, ExternalLink, Info, Sparkles } from "lucide-react";
import ProviderCard from "@/components/settings/ProviderCard";
import { providers } from "@/lib/mock-providers";
import { useProviders } from "@/lib/providers-store";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";
import { FEATURES } from "@/lib/features";
import { SettingsPageHeader } from "@/components/settings/ui";

/** Hosted/platform users never need to see all 9 self-host provider cards
 * (Anthropic, OpenAI, Google, Mistral, Groq, xAI, OpenRouter, LM Studio,
 * Ollama) — a platform key is already active by default (see
 * lib/llm/platformKeys.ts), and BYOK here is purely an optional override.
 * One card: bring a key if you want to, or do nothing and it already works.
 * Self-host mode is unaffected — that flow still needs the full grid since
 * there's no operator managing a shared key at all. */
function SingleKeyCard() {
  const { show } = useToast();
  const { state, connect, disconnect, platformProviders } = useProviders();
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);

  // The BYOK override always targets Groq — it's the fastest/cheapest
  // OpenAI-compatible option and the one platform key that's actually live
  // (see platformKeys.ts); a hosted user connecting their own key almost
  // certainly wants a bigger/different model than the free included one.
  const provider = providers.find((p) => p.id === "groq")!;
  const connection = state[provider.id];
  const isConnected = !!connection?.connected;
  const hasPlatformKey = platformProviders.includes(provider.id);

  async function handleConnect() {
    if (!keyInput.trim()) {
      show("Enter an API key first.");
      return;
    }
    setBusy(true);
    try {
      await connect(provider.id, keyInput.trim());
      show("Your key is active — agents and chat now use it.");
      setKeyInput("");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to connect.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await disconnect(provider.id);
      show("Disconnected — back to the plan's included model.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disconnect.");
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
              {isConnected ? "Your API key" : "Included model"}
              {isConnected ? (
                <span className="flex items-center gap-1 rounded-full bg-ui-success-soft px-2 py-0.5 text-xs font-medium text-ui-success-text">
                  <Check size={10} /> Connected
                </span>
              ) : hasPlatformKey ? (
                <span className="flex items-center gap-1 rounded-full bg-ui-info-soft px-2 py-0.5 text-xs font-medium text-ui-info-text">
                  <Sparkles size={10} /> Ready to use
                </span>
              ) : null}
            </div>
            <div className="text-[12px] text-ui-muted">
              {isConnected
                ? "Chat uses your own key first and falls back automatically to our default models if it fails. No usage limits from us."
                : "Chat and agents already work on the model included with your plan. Bring your own key for a different model or no usage limits."}
            </div>
          </div>
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-ui-subtle hover:text-ui-text"
        >
          Get a key <ExternalLink size={11} />
        </a>
      </div>

      {isConnected ? (
        <div className="flex items-center justify-between rounded-lg bg-ui-surface-muted px-3 py-2 text-[12px] text-ui-muted">
          <span className="min-w-0 break-all font-mono">
            {connection.apiKey?.includes("•")
              ? connection.apiKey
              : connection.apiKey
                ? `${connection.apiKey.slice(0, 4)}••••${connection.apiKey.slice(-2)}`
                : ""}
          </span>
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="font-medium text-ui-danger-text hover:underline disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
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
            {busy ? "Activating..." : "Activate"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function LlmProvidersPage() {
  const { connectedModels, primaryModel } = useProviders();

  if (FEATURES.PLATFORM_MODE) {
    return (
      <div className="min-w-0 max-w-3xl">
        <SettingsPageHeader
          title="LLM Provider"
          caption="Your plan already includes models for chat and agents — nothing to set up. If you bring your own key, chat uses it first and falls back automatically to our default models if it fails."
        />
        <SingleKeyCard />
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-3xl">
      <SettingsPageHeader
        title="LLM Providers"
        caption={<>Connect the model providers your agents can use. Pick one model as your preferred model — chat uses it first, and if it&apos;s unavailable it falls back automatically to our default models where the plan includes them.</>}
      />

      <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-ui-border bg-ui-surface-muted px-4 py-3 text-[13px] text-ui-muted">
        <Info size={14} className="shrink-0 text-ui-muted" aria-hidden="true" />
        {connectedModels.length === 0
          ? "No providers connected yet. Connect at least one to start using the chat and agents."
          : primaryModel
            ? `Preferred model: ${primaryModel}`
            : "Providers connected — pick a preferred model on any connected card."}
      </div>

      <div className="space-y-3">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>
    </div>
  );
}
