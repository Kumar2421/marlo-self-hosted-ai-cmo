"use client";

import { useState } from "react";
import { Check, ExternalLink, Info, Sparkles } from "lucide-react";
import ProviderCard from "@/components/settings/ProviderCard";
import { providers } from "@/lib/mock-providers";
import { useProviders } from "@/lib/providers-store";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";
import { FEATURES } from "@/lib/features";

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
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandIcon id={provider.id} color={provider.color} fallback={provider.icon} size={19} />
          <div>
            <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-gray-900">
              {isConnected ? "Your API key" : "Included model"}
              {isConnected ? (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-xs font-medium text-ui-accent-strong">
                  <Check size={10} /> Connected
                </span>
              ) : hasPlatformKey ? (
                <span className="flex items-center gap-1 rounded-full bg-[#eef2ff] px-2 py-0.5 text-xs font-medium text-[#4338ca]">
                  <Sparkles size={10} /> Ready to use
                </span>
              ) : null}
            </div>
            <div className="text-[12px] text-gray-500">
              {isConnected
                ? "Chat and agents use your own key — no usage limits from us."
                : "Chat and agents already work on the model included with your plan. Bring your own key for a different model or no usage limits."}
            </div>
          </div>
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-ui-subtle hover:text-gray-700"
        >
          Get a key <ExternalLink size={11} />
        </a>
      </div>

      {isConnected ? (
        <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
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
            className="font-medium text-red-600 hover:underline disabled:opacity-50"
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
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
          />
          <button
            onClick={handleConnect}
            disabled={busy}
            className="shrink-0 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
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
        <h1 className="text-[15px] font-semibold text-gray-900">LLM Provider</h1>
        <p className="mb-4 text-[13px] text-gray-500">
          Your plan already includes a model for chat and agents — nothing to set up. Bring your own key only if
          you want a different model or no usage limits.
        </p>
        <SingleKeyCard />
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-3xl">
      <h1 className="text-[15px] font-semibold text-gray-900">LLM Providers</h1>
      <p className="mb-4 text-[13px] text-gray-500">
        Connect the model providers your agents can use. Pick one model as primary — that&apos;s what
        the chat and agents default to.
      </p>

      <div className="mb-5 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">
        <Info size={14} className="shrink-0 text-ui-faint" />
        {connectedModels.length === 0
          ? "No providers connected yet. Connect at least one to start using the chat and agents."
          : primaryModel
            ? `Primary model: ${primaryModel}`
            : "Providers connected — pick a primary model on any connected card."}
      </div>

      <div className="space-y-3">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>
    </div>
  );
}
