"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { SkeletonCard } from "@/components/shared/Skeleton";
import {
  Layers,
  ChevronLeft,
  Pencil,
  Plus,
  ChevronRight,
  RefreshCw,
  Globe,
  FolderOpen,
  Users,
  Link2,
  X,
  Sparkles,
  Loader2,
} from "lucide-react";
import { DOC_TYPES } from "@/lib/document-types";
import { FEATURES } from "@/lib/features";
import CollapsedRail, { RailButton } from "./CollapsedRail";
import { useToast } from "./Toast";
import { useProject } from "@/lib/project-store";
import { useProjectContext } from "@/lib/context-data";
import { selectContextPanelCompetitors, selectContextPanelDocumentStatus } from "@/lib/context-panel-adapter";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useTerminalLog } from "@/lib/terminal-log-store";
import ProductInfoPanel from "./documents/ProductInfoPanel";
import MarketingStrategyPanel from "./documents/MarketingStrategyPanel";
import CompetitorAnalysisPanel from "./documents/CompetitorAnalysisPanel";
import CompetitorComparisonPanel from "./documents/CompetitorComparisonPanel";
import ContentStrategyPanel from "./documents/ContentStrategyPanel";
import DesignGuidePanel from "./documents/DesignGuidePanel";
import { WebsiteIcon } from "@/components/shared/WebsiteIcon";

// Long descriptions clamp to 4 lines with a toggle; short ones render as-is.
function ProjectDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  return (
    <div className="mb-6">
      <p
        id="project-description"
        ref={ref}
        className={`dash-body text-gray-500 ${expanded ? "" : "line-clamp-4"}`}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="project-description"
          className="dash-focus dash-meta mt-1 font-medium text-gray-600 hover:text-gray-900"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
// The project header block and its loading skeleton share this height, so the swap to real content doesn't shift the Documents list below it.
const HEADER_BLOCK = "min-h-[228px] md:min-h-[284px]";

export default function ContextPanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const [docsExpanded, setDocsExpanded] = useState(true);
  const [compsExpanded, setCompsExpanded] = useState(true);
  const [productInfoOpen, setProductInfoOpen] = useState(false);
  const [marketingStrategyOpen, setMarketingStrategyOpen] = useState(false);
  const [competitorAnalysisOpen, setCompetitorAnalysisOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [contentStrategyOpen, setContentStrategyOpen] = useState(false);
  const [designGuideOpen, setDesignGuideOpen] = useState(false);
  const [addingCompetitor, setAddingCompetitor] = useState(false);
  const [newCompetitorUrl, setNewCompetitorUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const { show } = useToast();
  const { project, loading, competitorsVersion, documentsVersion } = useProject();
  const {
    documents,
    competitors: contextCompetitors,
    loading: contextLoading,
    error: contextError,
    refresh: refreshContext,
  } = useProjectContext();
  const competitors = useMemo(
    () => selectContextPanelCompetitors(contextCompetitors),
    [contextCompetitors],
  );
  const competitorsLoading = contextLoading && contextCompetitors.length === 0;
  const { primaryModel } = useProviders();
  const { log } = useTerminalLog();

  const documentStatus = useMemo(
    () => selectContextPanelDocumentStatus(documents),
    [documents],
  );

  useEffect(() => {
    if (contextError) {
      show("Failed to load shared project context.");
    }
  }, [contextError, show]);

  // Context documents are generated in the background after onboarding
  // finishes (see project-store.tsx), so they land AFTER the dashboard's
  // initial fetch. documentsVersion bumps as each one saves; refetch then so
  // the panel fills in live instead of waiting for a manual reload. Skips the
  // initial render — that data came with the first load.
  const seenDocumentsVersion = useRef(documentsVersion);
  useEffect(() => {
    if (documentsVersion === seenDocumentsVersion.current) return;
    seenDocumentsVersion.current = documentsVersion;
    refreshContext();
  }, [documentsVersion, refreshContext]);

  const seenCompetitorsVersion = useRef(competitorsVersion);
  useEffect(() => {
    if (competitorsVersion === seenCompetitorsVersion.current) return;
    seenCompetitorsVersion.current = competitorsVersion;
    refreshContext();
  }, [competitorsVersion, refreshContext]);

  async function handleAddCompetitor() {
    const url = newCompetitorUrl.trim();
    if (!url) return;
    try {
      const res = await fetch("/api/project/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        show(data.error || "Failed to add competitor.");
        return;
      }
      const data = await res.json();
      setNewCompetitorUrl("");
      setAddingCompetitor(false);
      await refreshContext();
    } catch {
      show("Failed to add competitor.");
    }
  }

  async function handleDiscoverCompetitors() {
    // A model is optional: web search finds competitors on its own, a model only refines them.
    const providerId = primaryModel ? findProviderForModel(primaryModel) : null;

    setDiscovering(true);
    log("Looking for real competitors...");
    try {
      const res = await fetch("/api/project/competitors/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: primaryModel ?? undefined, providerId: providerId ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to discover competitors"}`);
        show(data.error || "Failed to discover competitors.");
        return;
      }

      const added: { url: string }[] = data.added ?? [];
      if (added.length === 0) {
        log(
          data.usedWebSearch
            ? "No confident competitors found — try adding one manually."
            : "No Tavily key connected, so I only had existing site data to go on — no confident competitors found."
        );
        show("No new competitors found.");
      } else {
        const names = added.map((a) => a.url.replace(/^https?:\/\//, "")).join(", ");
        log(
          `${data.usedWebSearch ? "Searched the web and found" : "Based on your site's own content, found"} ${added.length} real competitor${added.length === 1 ? "" : "s"}: ${names}.`
        );
        show(`Found ${added.length} competitor${added.length === 1 ? "" : "s"}.`);
        await refreshContext();
      }
    } catch {
      log("⚠ Couldn't reach the competitor discovery service.");
      show("Failed to discover competitors.");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleRemoveCompetitor(id: string) {
    try {
      const res = await fetch(`/api/project/competitors?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Failed to remove competitor");
      }
      await refreshContext();
    } catch {
      show("Failed to remove competitor — it may still be saved.");
      await refreshContext();
    }
  }

  if (!open) {
    return (
      <CollapsedRail onExpand={onToggle}>
        <RailButton icon={<Globe size={15} />} label="Brand" onClick={onToggle} />
        <RailButton icon={<FolderOpen size={15} />} label="Docs" onClick={onToggle} />
        <RailButton icon={<Users size={15} />} label="Comps" onClick={onToggle} />
        <div className="mt-auto pt-2">
          <button
            onClick={onToggle}
            className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#00ab92] text-[11px] font-semibold text-[#00ab92]"
            title="On-Page Score: 97"
          >
            97
          </button>
          <div className="mt-1 text-center text-[9px] font-medium text-gray-400">SEO</div>
        </div>
      </CollapsedRail>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white">
      <div className="dash-panel-header">
        <div className="dash-title">
          <Layers size={15} className="text-gray-500" />
          Context
        </div>
        <button onClick={onToggle} className="hidden text-gray-400 hover:text-gray-700 md:block" title="Collapse">
          <ChevronLeft size={15} />
        </button>
      </div>

      <div className="okara-scroll flex-1 overflow-y-auto px-4 py-4">
        {loading || (project && contextLoading && documents.length === 0 && contextCompetitors.length === 0) ? (
          <div key="header-skeleton" className={HEADER_BLOCK} aria-busy="true" role="status" aria-label="Loading">
            <div className="mb-2.5 flex items-center gap-2">
              <div className="h-6 w-6 animate-pulse rounded-full bg-gray-200" />
              <div className="h-3.5 w-32 animate-pulse rounded bg-gray-200" />
            </div>
            <div className="mb-3 h-[23px] w-20 animate-pulse rounded-full bg-gray-100" />
            <div className="mb-4 h-[59px] animate-pulse rounded-lg bg-gray-100" />
            <div className="h-[44px] animate-pulse rounded-lg bg-gray-100" />
          </div>
        ) : !project ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center">
            <Link2 size={18} className="text-gray-300" />
            <p className="text-[13px] font-medium text-gray-700">No project yet</p>
            <p className="text-[12px] text-gray-500">
              Click the project switcher at the top of the dashboard and choose{" "}
              <span className="font-medium">+ New project</span> to link a website — Context,
              Analytics, and every agent will use it from there.
            </p>
          </div>
        ) : (
          <div key="header" className={HEADER_BLOCK}>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-indigo-400" />
                <span className="text-[13px] font-semibold text-gray-900">{project.name}</span>
              </div>
              <button onClick={() => show("Edit project name — coming soon.")} className="text-gray-400 hover:text-gray-700">
                <Pencil size={13} />
              </button>
            </div>

            {project.category && (
              <span className="mb-3 inline-block rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] text-gray-500">
                {project.category}
              </span>
            )}

            <div className="mb-4">
              <label className="dash-section-label mb-1.5 flex items-center gap-1.5">
                <Link2 size={11} /> Website
              </label>
              <a
                href={project.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700 hover:underline"
              >
                {project.url.replace(/^https?:\/\//, "")}
              </a>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={() => show("Team size & category form — coming soon.")}
                className="flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
              >
                <Plus size={11} /> Add team size &amp; category
              </button>
              <button
                onClick={() => show("Rewriting project description...")}
                className="flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
              >
                <RefreshCw size={11} /> Improve writing quality
              </button>
            </div>

            {project.description && (
              <ProjectDescription text={project.description} />
            )}
          </div>
        )}

        <div className="mb-1 flex w-full items-center justify-between">
          <button
            onClick={() => setDocsExpanded((v) => !v)}
            aria-expanded={docsExpanded}
            className="dash-focus dash-section-label flex-1 py-1 text-left"
          >
            Documents
          </button>
        </div>
        {docsExpanded && (
          <div className="mb-6 divide-y divide-gray-100">
            {DOC_TYPES.map((doc) => {
              const hasContent =
                (doc.docType === "product_info" && documentStatus.productInfo) ||
                (doc.docType === "marketing_strategy" && documentStatus.marketingStrategy) ||
                (doc.docType === "competitor_analysis" && documentStatus.competitorAnalysis) ||
                (doc.docType === "content_strategy" && documentStatus.contentStrategy) ||
                (doc.docType === "design_guide" && documentStatus.designGuide);
              return (
                <button
                  key={doc.docType}
                  onClick={() => {
                    if (!project) {
                      show("Link a website first — see the project switcher at the top.");
                    } else if (!doc.available) {
                      show(`${doc.name} isn't built yet.`);
                    } else if (doc.docType === "product_info") {
                      setProductInfoOpen(true);
                    } else if (doc.docType === "marketing_strategy") {
                      setMarketingStrategyOpen(true);
                    } else if (doc.docType === "competitor_analysis") {
                      setCompetitorAnalysisOpen(true);
                    } else if (doc.docType === "content_strategy") {
                      setContentStrategyOpen(true);
                    } else if (doc.docType === "design_guide") {
                      setDesignGuideOpen(true);
                    }
                  }}
                  className="dash-focus dash-body flex min-h-9 w-full items-center justify-between py-1.5 text-left text-gray-700 hover:text-gray-900"
                >
                  <span className="flex items-center gap-2">
                    {doc.name}
                    {hasContent && <span className="h-1.5 w-1.5 rounded-full bg-[#00ab92]" />}
                  </span>
                  {!doc.available ? (
                    <span className="text-[11px] text-gray-400">Coming soon</span>
                  ) : (
                    <ChevronRight size={13} className="text-gray-300" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={() => setCompsExpanded((v) => !v)}
          aria-expanded={compsExpanded}
          className="dash-focus mb-2 flex min-h-9 w-full items-center justify-between"
        >
          <h3 className="dash-section-label">Competitors</h3>
          <span className="flex items-center gap-2.5">
            <span
              role="button"
              title="Find competitors automatically"
              onClick={(e) => {
                e.stopPropagation();
                if (!project) {
                  show("Link a website first — see the project switcher at the top.");
                  return;
                }
                if (!discovering) handleDiscoverCompetitors();
              }}
              className={`text-gray-400 hover:text-gray-700 ${discovering ? "pointer-events-none" : ""}`}
            >
              {discovering ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            </span>
            <span
              role="button"
              title="Add a competitor manually"
              onClick={(e) => {
                e.stopPropagation();
                if (!project) {
                  show("Link a website first — see the project switcher at the top.");
                  return;
                }
                setAddingCompetitor((v) => !v);
              }}
              className="text-gray-400 hover:text-gray-700"
            >
              <Plus size={14} />
            </span>
          </span>
        </button>
        {compsExpanded && (
          <>
            {addingCompetitor && (
              <div className="mb-2 flex gap-2">
                <input
                  autoFocus
                  value={newCompetitorUrl}
                  onChange={(e) => setNewCompetitorUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCompetitor()}
                  placeholder="competitor.com"
                  className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
                />
                <button
                  onClick={handleAddCompetitor}
                  className="rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
                >
                  Add
                </button>
              </div>
            )}
            {competitors.length > 0 && (
              <button
                onClick={() => setComparisonOpen(true)}
                className="mb-3 flex w-full items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] font-medium text-blue-700 hover:bg-blue-100"
              >
                View Comparison Table
              </button>
            )}
            {competitorsLoading ? (
              <div className="min-h-[56px] space-y-1.5" role="status" aria-label="Loading">
                <div className="h-6 animate-pulse rounded bg-gray-100" />
                <div className="h-6 w-2/3 animate-pulse rounded bg-gray-100" />
              </div>
            ) : competitors.length === 0 ? (
              <p className="text-[12px] leading-5 text-gray-400">
                No competitors added yet. Add one manually above, or use &ldquo;Find competitors automatically&rdquo;
                {FEATURES.PLATFORM_MODE
                  ? "."
                  : " — works best with a Tavily API key connected (Settings → API Credentials)."}
              </p>
            ) : (
              <div className="dash-body text-gray-700">
                {competitors.map((c) => (
                  <div key={c.id} className="group flex min-h-9 items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <WebsiteIcon url={c.url} size={6} />
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate hover:text-gray-900 hover:underline"
                      >
                        {c.url.replace(/^https?:\/\//, "")}
                      </a>
                    </div>
                    <button
                      onClick={() => handleRemoveCompetitor(c.id)}
                      aria-label="Remove competitor"
                      className="dash-focus shrink-0 p-1 text-gray-300 opacity-0 hover:text-gray-600 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="dash-meta shrink-0 border-t border-gray-200 px-4 py-3 text-gray-400">
        What your CMO reads before writing anything — edit any of it, anytime.
      </div>

      {productInfoOpen && (
        <ProductInfoPanel
          onClose={() => {
            setProductInfoOpen(false);
            refreshContext();
          }}
        />
      )}
      {marketingStrategyOpen && (
        <MarketingStrategyPanel
          onClose={() => {
            setMarketingStrategyOpen(false);
            refreshContext();
          }}
        />
      )}
      {competitorAnalysisOpen && (
        <CompetitorAnalysisPanel
          onClose={() => {
            setCompetitorAnalysisOpen(false);
            refreshContext();
          }}
        />
      )}
      {comparisonOpen && <CompetitorComparisonPanel onClose={() => setComparisonOpen(false)} />}
      {contentStrategyOpen && (
        <ContentStrategyPanel
          onClose={() => {
            setContentStrategyOpen(false);
            refreshContext();
          }}
        />
      )}
      {designGuideOpen && (
        <DesignGuidePanel
          onClose={() => {
            setDesignGuideOpen(false);
            refreshContext();
          }}
        />
      )}
    </div>
  );
}
