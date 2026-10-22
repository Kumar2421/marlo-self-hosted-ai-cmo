"use client";

import { plainError } from "@/lib/plainError";
import { X, ChevronsLeft, RefreshCw, Loader2, Settings } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useToast } from "@/components/dashboard/Toast";
import { useTerminalLog } from "@/lib/terminal-log-store";
import { WebsiteIcon } from "@/components/shared/WebsiteIcon";
import { useDialog } from "@/components/shared/useDialog";
import { useProject } from "@/lib/project-store";
import {
  buildComparisonView,
  parseComparisonMarkdown,
  type StoredComparison,
} from "@/lib/domain/documents/comparisonView";

function FeatureCompare({
  ourFeatures,
  competitorFeatures,
  compareToOurs,
}: {
  ourFeatures: string[];
  competitorFeatures: string[];
  /** false when we have no real data about the user's own product: list features without tick/dash claims. */
  compareToOurs: boolean;
}) {
  const norm = (f: string) => f.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const ours = new Set(ourFeatures.map(norm));
  const all = compareToOurs ? Array.from(new Set([...ourFeatures, ...competitorFeatures])) : competitorFeatures;

  if (all.length === 0) return <p className="text-[12px] text-gray-400">No features found on the site.</p>;

  return (
    <div className="space-y-1.5">
      {all.map((feature) => {
        const has = ours.has(norm(feature));
        return (
          <div key={feature} className="flex items-center gap-2 text-[12px]">
            {compareToOurs ? (
              has ? <span className="text-green-600">✓</span> : <span className="text-gray-300">−</span>
            ) : (
              <span className="text-gray-300">•</span>
            )}
            <span className={!compareToOurs || has ? "text-gray-700" : "text-gray-400"}>{feature}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function CompetitorComparisonPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const titleId = useId();
  const panelRef = useDialog<HTMLDivElement>(true, onClose);
  const { project } = useProject();
  const [stored, setStored] = useState<StoredComparison>({ ownProduct: null, competitors: [] });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const { primaryModel } = useProviders();
  const { show } = useToast();
  const { log, logDone } = useTerminalLog();
  const view = buildComparisonView(
    { name: project?.name ?? "Your product", url: project?.url ?? "" },
    stored,
  );
  const competitors = view.competitors;
  const ownReady = view.own.status === "ready";

  useEffect(() => {
    loadComparison();
  }, []);

  async function loadComparison() {
    setLoading(true);
    try {
      const res = await fetch(`/api/project/documents/competitor-comparison?ts=${Date.now()}`);
      const data = await res.json();

      if (data.document?.content) {
        setStored(parseComparisonMarkdown(data.document.content));
      } else {
        setStored({ ownProduct: null, competitors: [] });
      }
    } catch (err) {
      console.error("Error loading comparison:", err);
      setStored({ ownProduct: null, competitors: [] });
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    setApiKeyError(null);

    if (!primaryModel) {
      show("No primary model selected. Configure LLM Providers in Settings.");
      return;
    }
    const providerId = findProviderForModel(primaryModel);
    if (!providerId) {
      show("Could not determine provider for the selected model.");
      return;
    }

    setGenerating(true);
    log("Extracting competitor pricing & features...");

    try {
      const res = await fetch("/api/project/documents/competitor-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: primaryModel, providerId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errText = data.error || "Failed to generate comparison.";
        log(`⚠ ${errText}`);

        // Check if this is an API key error
        if (errText.includes("API key") || errText.includes("isn't properly connected")) {
          setApiKeyError(errText);
          show("LLM provider not configured. Click 'Settings' to add your API key.");
        } else {
          show(errText);
        }
        return;
      }

      await res.text();
      logDone("Comparison generated.");
      show("Comparison generated.");
      // Wait a moment for DB to fully commit, then refresh
      await new Promise(resolve => setTimeout(resolve, 500));
      await loadComparison();
    } catch (err) {
      console.error("[comparison] generate failed", err);
      const errText = plainError(err, "Failed to generate comparison.");
      log(`⚠ ${errText}`);
      show("Failed to generate comparison.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRefresh() {
    await handleGenerate();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-4xl flex-col border-l border-gray-200 bg-white shadow-2xl outline-none"
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <div id={titleId} className="text-[14px] font-semibold text-gray-900">Competitor Comparison</div>
          <div className="flex items-center gap-3 text-gray-400">
            {competitors.length > 0 && (
              <button
                onClick={handleRefresh}
                disabled={generating}
                title="Refresh"
                className="hover:text-gray-700 disabled:opacity-50"
              >
                {generating ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              </button>
            )}
            <button onClick={onClose} title="Collapse" className="hover:text-gray-700">
              <ChevronsLeft size={16} />
            </button>
            <button onClick={onClose} title="Close" className="hover:text-gray-700">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="okara-scroll flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {loading ? (
              <SkeletonComparison />
            ) : apiKeyError ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="rounded-lg bg-red-50 p-4 text-left">
                  <p className="text-[13px] font-medium text-red-900 mb-2">LLM Provider Not Connected</p>
                  <p className="text-[12px] text-red-700 mb-3">{apiKeyError}</p>
                </div>
                <button
                  onClick={() => router.push("/settings?tab=providers")}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-blue-700"
                >
                  <Settings size={14} />
                  Open Settings
                </button>
              </div>
            ) : competitors.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-[14px] font-medium text-gray-900">No comparison yet</p>
                <p className="max-w-xs text-[13px] text-gray-500">
                  Generate a comparison from your competitors — we&apos;ll extract pricing and key
                  features from their websites.
                </p>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="mt-2 flex items-center gap-2 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
                >
                  {generating ? <Loader2 size={14} className="animate-spin" /> : null}
                  {generating ? "Generating..." : "Generate Comparison"}
                </button>
              </div>
            ) : (
              <>
                {/* Overview */}
                <div>
                  <h2 className="mb-2 text-[14px] font-semibold text-gray-900">How you stack up</h2>
                  <p className="text-[13px] text-gray-600">
                    {ownReady
                      ? "Side-by-side comparison of pricing and core features, read from each website. Green checkmarks show features your site also lists; dashes show gaps."
                      : "Pricing and core features read from each competitor's website."}
                  </p>
                </div>

                {/* Comparison Grid */}
                <div className="space-y-4">
                  {/* Your product (highlighted) */}
                  <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4" data-testid="own-product-card">
                    <div className="mb-3">
                      <h3 className="text-[13px] font-semibold text-blue-900">{view.own.name}</h3>
                      {ownReady ? (
                        <p className="text-[12px] font-semibold text-green-700">{view.own.startingPrice}</p>
                      ) : null}
                    </div>
                    {ownReady ? (
                      view.own.features.length > 0 ? (
                        <FeatureCompare
                          ourFeatures={view.own.features}
                          competitorFeatures={competitors.flatMap((c) => c.features)}
                          compareToOurs
                        />
                      ) : (
                        <p className="text-[12px] text-gray-500">No features found on your site.</p>
                      )
                    ) : view.own.status === "not_extracted" ? (
                      <p className="text-[12px] text-gray-600">
                        Not extracted yet — we could not read pricing or features from your site. Refresh to try again.
                      </p>
                    ) : (
                      <p className="text-[12px] text-gray-600">
                        Regenerate to compare your own product. This comparison was saved before your own site was included.
                      </p>
                    )}
                  </div>

                  {/* Competitors */}
                  {competitors.map((competitor) => (
                    <div key={competitor.id} className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <WebsiteIcon url={competitor.url} size={7} />
                        <div>
                          <h3 className="text-[13px] font-semibold text-gray-900">{competitor.name}</h3>
                          <p className="text-[12px] text-gray-600">{competitor.startingPrice}</p>
                        </div>
                      </div>
                      <FeatureCompare
                        ourFeatures={ownReady ? view.own.features : []}
                        competitorFeatures={competitor.features}
                        compareToOurs={ownReady}
                      />
                    </div>
                  ))}
                </div>

                {/* Where you stand: derived only from the extracted data, no claims */}
                {ownReady && (view.gaps.length > 0 || view.differentiators.length > 0) && (
                  <div className="rounded-lg bg-gray-50 p-4" data-testid="where-you-stand">
                    <h3 className="mb-2 text-[13px] font-semibold text-gray-900">Where you stand</h3>
                    <div className="space-y-3 text-[12px] text-gray-700">
                      {view.gaps.length > 0 && (
                        <div>
                          <p className="mb-1 font-medium">Listed by competitors, not found on your site</p>
                          <ul className="list-disc space-y-1 pl-4">
                            {view.gaps.map((f) => <li key={f}>{f}</li>)}
                          </ul>
                        </div>
                      )}
                      {view.differentiators.length > 0 && (
                        <div>
                          <p className="mb-1 font-medium">Listed on your site only</p>
                          <ul className="list-disc space-y-1 pl-4">
                            {view.differentiators.map((f) => <li key={f}>{f}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonComparison() {
  return (
    <div className="space-y-4">
      {/* Skeleton card for your product */}
      <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4 animate-pulse">
        <div className="mb-3">
          <div className="mb-2 h-4 w-24 bg-blue-200 rounded"></div>
          <div className="h-3 w-32 bg-blue-100 rounded"></div>
        </div>
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-2">
              <div className="h-3 w-3 bg-blue-200 rounded flex-shrink-0 mt-0.5"></div>
              <div className="h-3 flex-1 bg-blue-100 rounded"></div>
            </div>
          ))}
        </div>
      </div>

      {/* Skeleton Competitor Cards */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 animate-pulse">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-7 w-7 bg-gray-200 rounded flex-shrink-0"></div>
            <div className="flex-1">
              <div className="mb-1 h-3 w-32 bg-gray-200 rounded"></div>
              <div className="h-3 w-24 bg-gray-100 rounded"></div>
            </div>
          </div>
          <div className="space-y-1.5">
            {[1, 2, 3, 4].map((j) => (
              <div key={j} className="flex gap-2">
                <div className="h-3 w-3 bg-gray-200 rounded flex-shrink-0 mt-0.5"></div>
                <div className="h-3 flex-1 bg-gray-100 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
