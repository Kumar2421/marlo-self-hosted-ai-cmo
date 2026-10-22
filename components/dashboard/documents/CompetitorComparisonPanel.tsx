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

type Competitor = {
  id: string;
  url: string;
  name: string;
  startingPrice: string;
  features: string[];
};

type ComparisonData = {
  ourProduct: Competitor;
  competitors: Competitor[];
};

const OUR_PRODUCT: Competitor = {
  id: "marlo",
  url: "https://github.com/Kumar2421/marlo",
  name: "Marlo",
  startingPrice: "$0 (self-hosted)",
  features: [
    "SEO audit & crawling",
    "Competitor analysis",
    "Real-time lead tracking",
    "GitHub code fixes",
    "Gmail reply automation",
  ],
};

function FeatureCompare({
  ourFeatures,
  competitorFeatures,
}: {
  ourFeatures: string[];
  competitorFeatures: string[];
}) {
  const allFeatures = Array.from(new Set([...ourFeatures, ...competitorFeatures]));

  return (
    <div className="space-y-1.5">
      {allFeatures.map((feature) => (
        <div key={feature} className="flex items-center gap-2 text-[12px]">
          {ourFeatures.includes(feature) ? (
            <span className="text-green-600">✓</span>
          ) : (
            <span className="text-gray-300">−</span>
          )}
          <span className={ourFeatures.includes(feature) ? "text-gray-700" : "text-gray-400"}>
            {feature}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CompetitorComparisonPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const titleId = useId();
  const panelRef = useDialog<HTMLDivElement>(true, onClose);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const { primaryModel } = useProviders();
  const { show } = useToast();
  const { log, logDone } = useTerminalLog();

  useEffect(() => {
    loadComparison();
  }, []);

  async function loadComparison() {
    setLoading(true);
    try {
      const res = await fetch(`/api/project/documents/competitor-comparison?ts=${Date.now()}`);
      const data = await res.json();
      console.log("Competitor comparison GET response:", data);

      if (data.document?.content) {
        const markdown = data.document.content;
        // Parse markdown content to extract competitor data
        console.log("[loader] Raw markdown length:", markdown.length);
        console.log("[loader] First 800 chars:", markdown.substring(0, 800));
        console.log("[loader] Markdown contains ###:", markdown.includes("###"));
        console.log("[loader] Number of ### sections:", (markdown.match(/###/g) || []).length);
        console.log("[loader] Markdown contains **URL:**:", markdown.includes("**URL:**"));
        console.log("[loader] Markdown contains **Key Features:**:", markdown.includes("**Key Features:**"));

        const parsed = parseComparisonMarkdown(markdown);
        console.log("[loader] Parsed result length:", parsed.length);
        console.log("[loader] First parsed competitor:", parsed[0]);
        setCompetitors(parsed);
      } else {
        console.log("No document content found");
        setCompetitors([]);
      }
    } catch (err) {
      console.error("Error loading comparison:", err);
      setCompetitors([]);
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
                    Side-by-side comparison of pricing and core features. Green checkmarks show features you
                    have; dashes show gaps.
                  </p>
                </div>

                {/* Comparison Grid */}
                <div className="space-y-4">
                  {/* Our Product (Highlighted) */}
                  <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4">
                    <div className="mb-3">
                      <h3 className="text-[13px] font-semibold text-blue-900">{OUR_PRODUCT.name}</h3>
                      <p className="text-[12px] font-semibold text-green-700">{OUR_PRODUCT.startingPrice}</p>
                    </div>
                    <FeatureCompare
                      ourFeatures={OUR_PRODUCT.features}
                      competitorFeatures={competitors.flatMap((c) => c.features)}
                    />
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
                        ourFeatures={OUR_PRODUCT.features}
                        competitorFeatures={competitor.features}
                      />
                    </div>
                  ))}
                </div>

                {/* Insights */}
                <div className="rounded-lg bg-gray-50 p-4">
                  <h3 className="mb-2 text-[13px] font-semibold text-gray-900">Why Marlo wins</h3>
                  <ul className="space-y-1.5 text-[12px] text-gray-700">
                    <li>
                      <strong>Cheaper or free</strong> — Free tier + affordable plans vs $99-120/month
                      competitors
                    </li>
                    <li>
                      <strong>Lead generation + email automation</strong> — Competitors focus on SEO only
                    </li>
                    <li>
                      <strong>Code-first fixes</strong> — Auto-generate GitHub PRs for SEO issues (unique)
                    </li>
                    <li>
                      <strong>All-in-one</strong> — SEO + leads + email vs juggling 3+ tools
                    </li>
                  </ul>
                </div>
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
      {/* Skeleton Marlo Card */}
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

function parseComparisonMarkdown(markdown: string): Competitor[] {
  const competitors: Competitor[] = [];
  const sections = markdown.split("###").slice(1);
  console.log("[parser] Sections:", sections.length, "First 300 chars:", sections[0]?.substring(0, 300));

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split("\n").filter((l) => l.trim());
    if (lines.length < 1) continue;

    const name = lines[0].trim();
    if (!name) continue;
    console.log(`[parser] ${i}: "${name}"`);

    const urlMatch = section.match(/\*\*URL:\*\* ([^\n]+)/);
    let url = urlMatch ? urlMatch[1].trim() : "";
    if (!url) {
      url = `https://${name.toLowerCase().replace(/\s+/g, "")}.com`;
    }
    console.log(`[parser]   URL: ${url} (matched=${!!urlMatch})`);

    const priceMatch = section.match(/\*\*Starting Price:\*\* ([^\n]+)/);
    const startingPrice = priceMatch ? priceMatch[1].trim() : "pricing not found";
    console.log(`[parser]   Price: ${startingPrice}`);

    // Extract features from lines that start with "- "
    const featureLines = section.split("\n").filter((l) => l.trim().startsWith("-"));
    const features = featureLines.map((l) => l.replace(/^-\s*/, "").trim()).filter((f) => f.length > 0);
    console.log(`[parser]   Features: ${features.length} (${featureLines.length} raw lines)`);
    console.log(`[parser]   Extracted features:`, features);

    const competitor = {
      id: name.toLowerCase().replace(/\s+/g, "-"),
      url,
      name,
      startingPrice,
      features: features.slice(0, 4),
    };
    competitors.push(competitor);
    console.log(`[parser] Added competitor:`, competitor);
  }

  console.log("[parser] Final result:", competitors.length, "competitors");
  console.log("[parser] Full result:", JSON.stringify(competitors, null, 2));
  return competitors;
}
