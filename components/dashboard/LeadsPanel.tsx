"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, ChevronLeft, Loader2, RefreshCw, X, ExternalLink, Mail, Search, Phone, Reply } from "lucide-react";
import CollapsedRail, { RailButton } from "./CollapsedRail";
import { useToast } from "./Toast";
import { useProject } from "@/lib/project-store";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useTerminalLog } from "@/lib/terminal-log-store";
import ComposeEmailModal from "./ComposeEmailModal";
import GmailOutreachBar from "./leads/GmailOutreachBar";
import { useGmailStatus } from "./leads/useGmailStatus";
import { useLeadProfile } from "./leads/useLeadProfile";
import LeadProfileWizard from "./leads/LeadProfileWizard";
import LeadProfileSearch from "./leads/LeadProfileSearch";
import BusinessSearchForm from "./leads/BusinessSearchForm";
import BusinessResults, { type BusinessSearchError } from "./leads/BusinessResults";
import type { BusinessLead } from "./leads/BusinessLeadCard";
import { SkeletonCard } from "@/components/shared/Skeleton";
import { FEATURES } from "@/lib/features";
import type { LeadSearchTarget } from "@/lib/domain/leads/leadProfile";
import {
  sortByFitScore,
  suggestCategory,
  suggestLocation,
  tagsWithStatus,
  websiteHref,
  type LeadStatus,
} from "@/lib/domain/leads/local/businessLead";

type Lead = {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  email: string | null;
  email_verified?: number | boolean;
  source_url: string | null;
  query: string;
  created_at: string;
  phone?: string | null;
  place_id?: string | null;
  lead_type?: "person" | "business";
  email_status?: "sent" | "failed" | null;
  emailed_at?: string | null;
  gmail_thread_id?: string | null;
  last_reply_at?: string | null;
  last_reply_snippet?: string | null;
  // Local business mode (Places + website enrichment); all optional, null for person leads.
  address?: string | null;
  website?: string | null;
  rating?: number | null;
  review_count?: number | null;
  whatsapp?: string | null;
  contact_url?: string | null;
  description?: string | null;
  maps_url?: string | null;
  fit_reason?: string | null;
  fit_score?: number | null;
  enrichment_status?: string | null;
  email_quality?: string | null;
  tags?: string[] | null;
};

/** Person leads keep their order; business leads are shown best fit first. */
function arrangeLeads(list: Lead[]): Lead[] {
  const persons = list.filter((l) => l.lead_type !== "business");
  const businesses = sortByFitScore(list.filter((l) => l.lead_type === "business"));
  return [...persons, ...businesses];
}

type PlacesPage = { leads?: Lead[]; nextPageToken?: string | null; duplicates?: number; error?: string };

/** One page of local places. Never throws: a network failure comes back as an error. */
async function requestPlaces(
  query: { category: string; location: string },
  pageToken?: string
): Promise<{ ok: true; page: PlacesPage } | { ok: false; error: BusinessSearchError }> {
  try {
    const res = await fetch("/api/agents/leads/places-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pageToken ? { ...query, pageToken } : query),
    });
    const data = (await res.json().catch(() => ({}))) as PlacesPage;
    if (!res.ok) {
      return { ok: false, error: { message: data.error || "Failed to search local businesses.", status: res.status } };
    }
    return { ok: true, page: data };
  } catch {
    return { ok: false, error: { message: "Couldn't reach the server. Check your connection and retry.", status: 0 } };
  }
}

export default function LeadsPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"person" | "business">("person");
  const [role, setRole] = useState("");
  const [companyOrIndustry, setCompanyOrIndustry] = useState("");
  const [location, setLocation] = useState("");
  // null means "not edited": the field shows the lead profile's suggestion.
  const [bizCategoryInput, setBizCategoryInput] = useState<string | null>(null);
  const [bizLocationInput, setBizLocationInput] = useState<string | null>(null);
  // The current session's business results, in the order they arrived.
  const [bizResultIds, setBizResultIds] = useState<string[]>([]);
  // The search that produced the current nextPageToken. Load more must reuse it, not the form.
  const [bizQuery, setBizQuery] = useState<{ category: string; location: string } | null>(null);
  const [bizNextToken, setBizNextToken] = useState<string | null>(null);
  const [bizDuplicates, setBizDuplicates] = useState(0);
  const [bizSearched, setBizSearched] = useState(false);
  const [bizLoadingMore, setBizLoadingMore] = useState(false);
  const [bizError, setBizError] = useState<BusinessSearchError | null>(null);
  const [bizRetry, setBizRetry] = useState<"search" | "more">("search");
  const [bizEmailLead, setBizEmailLead] = useState<Lead | null>(null);
  const gmail = useGmailStatus();
  const leadProfile = useLeadProfile();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const [googleCloudConnected, setGoogleCloudConnected] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [checkingReplies, setCheckingReplies] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState<{ leadId: string; subject: string; body: string } | null>(null);
  const [draftingFollowUp, setDraftingFollowUp] = useState<string | null>(null);
  const { show } = useToast();
  const { project, leadsVersion } = useProject();
  const { primaryModel } = useProviders();
  const { log, logDone } = useTerminalLog();

  // Business fields start from the confirmed lead profile and stay editable.
  const confirmedProfile = leadProfile.confirmed ? leadProfile.profile : null;
  const profileCategory = suggestCategory(confirmedProfile?.industries);
  const profileLocation = suggestLocation(confirmedProfile?.locations);
  const bizCategory = bizCategoryInput ?? profileCategory;
  const bizLocation = bizLocationInput ?? profileLocation;
  const bizFromProfile = (bizCategoryInput === null && profileCategory !== "") || (bizLocationInput === null && profileLocation !== "");

  const personLeads = leads.filter((l) => l.lead_type !== "business");
  const businessLeads = leads.filter((l) => l.lead_type === "business");
  const businessById = new Map(businessLeads.map((l) => [l.id, l]));
  const resultIdSet = new Set(bizResultIds);
  const bizResults = bizResultIds.map((id) => businessById.get(id)).filter((l): l is Lead => Boolean(l));
  const bizSaved = sortByFitScore(businessLeads.filter((l) => !resultIdSet.has(l.id)));

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agents/leads/search");
      const data = await res.json();
      setLeads(arrangeLeads(data.leads ?? []));
    } catch {
      // route unreachable - list just stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the fetch's own setLoading(true) doesn't run
    // synchronously inside the effect body (react-hooks/set-state-in-effect).
    if (open && project) queueMicrotask(() => loadLeads());
  }, [open, project?.id, leadsVersion, loadLeads]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings: { key: string; value: string }[] }) => {
        setGoogleCloudConnected(!!data.settings?.find((s) => s.key === "google_cloud_api_key")?.value);
      })
      .catch(() => {});
  }, [open]);

  async function handleCheckReplies() {
    setCheckingReplies(true);
    log("Checking Gmail threads for real replies...");
    try {
      const res = await fetch("/api/agents/leads/check-replies", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        show(data.error ?? "Failed to check replies.");
        logDone(`⚠ ${data.error ?? "Failed to check replies."}`);
        return;
      }
      if (data.error) {
        show(data.error);
        logDone(`⚠ ${data.error}`);
      } else {
        logDone(data.newReplies > 0 ? `Checked ${data.checked} thread(s) — ${data.newReplies} new repl${data.newReplies === 1 ? "y" : "ies"}.` : `Checked ${data.checked} thread(s) — no new replies.`);
      }
      if (data.newReplies > 0) await loadLeads();
    } catch {
      show("Failed to check replies.");
      logDone("⚠ Failed to check replies.");
    } finally {
      setCheckingReplies(false);
    }
  }

  async function handleDraftFollowUp(lead: Lead) {
    if (!primaryModel) {
      show("No primary model selected. Configure LLM Providers in Settings.");
      return;
    }
    const providerId = findProviderForModel(primaryModel);
    if (!providerId) {
      show("Could not determine provider for the selected model.");
      return;
    }
    setDraftingFollowUp(lead.id);
    log(`Drafting a follow-up for ${lead.name}'s reply...`);
    try {
      const res = await fetch("/api/agents/leads/draft-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, model: primaryModel, providerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(data.error ?? "Failed to draft a follow-up.");
        logDone(`⚠ ${data.error ?? "Failed to draft a follow-up."}`);
        return;
      }
      logDone(`Reply classified as "${data.classification}" — draft ready for review.`);
      setFollowUpDraft({ leadId: lead.id, subject: data.subject, body: data.body });
    } catch {
      show("Failed to draft a follow-up.");
      logDone("⚠ Failed to draft a follow-up.");
    } finally {
      setDraftingFollowUp(null);
    }
  }

  async function handleSearch(override?: LeadSearchTarget & { useProfile?: boolean }) {
    const q = override ?? { role, companyOrIndustry, location };
    if (!q.role.trim() && !q.companyOrIndustry.trim()) {
      show("Enter at least a role or a company/industry to search for.");
      return;
    }
    if (!primaryModel) {
      show("No primary model selected. Configure LLM Providers in Settings.");
      return;
    }
    const providerId = findProviderForModel(primaryModel);
    if (!providerId) {
      show("Could not determine provider for the selected model.");
      return;
    }

    setSearching(true);
    const filters = [q.role, q.companyOrIndustry, q.location].filter(Boolean).join(" · ") || "(no filters)";
    log(`Searching leads: ${filters}...`);
    log("Running real web searches (Tavily) and extracting real people from the results...");
    log("Then SMTP-verifying a guessed email for any lead search didn't find one for — this can take a minute...");
    try {
      const res = await fetch("/api/agents/leads/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: q.role, companyOrIndustry: q.companyOrIndustry, location: q.location, model: primaryModel, providerId, useProfile: override?.useProfile === true }),
      });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to search leads"}`);
        show(data.error || "Failed to search leads.");
        return;
      }
      const found: Lead[] = data.leads ?? [];
      setLeads((prev) => [...found, ...prev]);

      const foundEmail = found.filter((l) => l.email && !l.email_verified).length;
      const verifiedEmail = found.filter((l) => l.email_verified).length;
      const noEmail = found.length - foundEmail - verifiedEmail;
      logDone(
        `Found ${found.length} lead${found.length === 1 ? "" : "s"} — ${foundEmail} email${foundEmail === 1 ? "" : "s"} from search, ${verifiedEmail} SMTP-verified, ${noEmail} with no email.`
      );
      show(`Found ${found.length} lead${found.length === 1 ? "" : "s"}.`);
    } catch {
      log("⚠ Failed to search leads.");
      show("Failed to search leads.");
    } finally {
      setSearching(false);
    }
  }

  /** Open the guided setup once, automatically, when a project has no confirmed profile. */
  const needsProfile = !leadProfile.isLoading && !leadProfile.isError && !leadProfile.confirmed && Boolean(project);
  const showWizard = wizardOpen || (needsProfile && mode === "person" && !wizardDismissed);

  function closeWizard() {
    setWizardOpen(false);
    setWizardDismissed(true);
  }

  function confirmProfile(profile: NonNullable<typeof leadProfile.profile>) {
    leadProfile.save.mutate(
      { profile, confirm: true },
      {
        onSuccess: ({ profile: saved }) => {
          closeWizard();
          void handleSearch({ role: saved.roles[0] ?? "", companyOrIndustry: saved.industries[0] ?? "", location: saved.locations[0] ?? "", useProfile: true });
        },
      },
    );
  }

  async function handleBizSearch() {
    const query = { category: bizCategory.trim(), location: bizLocation.trim() };
    setBizRetry("search");
    if (!query.category || !query.location) {
      setBizError({ message: "Enter both a category and a location.", status: 400 });
      return;
    }

    setBizError(null);
    setSearching(true);
    log(`Searching local businesses: ${query.category} in ${query.location}...`);
    const outcome = await requestPlaces(query);
    setSearching(false);
    if (!outcome.ok) {
      log(`⚠ ${outcome.error.message}`);
      setBizError(outcome.error);
      return;
    }

    const found = outcome.page.leads ?? [];
    const foundIds = new Set(found.map((l) => l.id));
    setLeads((prev) => [...found, ...prev.filter((l) => !foundIds.has(l.id))]);
    setBizResultIds(found.map((l) => l.id));
    setBizQuery(query);
    setBizNextToken(outcome.page.nextPageToken ?? null);
    setBizDuplicates(outcome.page.duplicates ?? 0);
    setBizSearched(true);
    logDone(`Found ${found.length} real local business${found.length === 1 ? "" : "es"}.`);
    show(`Found ${found.length} business${found.length === 1 ? "" : "es"}.`);
  }

  /** Next page of the search that produced the current token. Appends, so nothing above moves. */
  async function handleBizLoadMore() {
    if (!bizQuery || !bizNextToken || bizLoadingMore) return;
    setBizRetry("more");
    setBizError(null);
    setBizLoadingMore(true);
    const outcome = await requestPlaces(bizQuery, bizNextToken);
    setBizLoadingMore(false);
    if (!outcome.ok) {
      setBizError(outcome.error);
      return;
    }

    const found = outcome.page.leads ?? [];
    setLeads((prev) => {
      const known = new Set(prev.map((l) => l.id));
      return [...prev, ...found.filter((l) => !known.has(l.id))];
    });
    setBizResultIds((prev) => [...prev, ...found.map((l) => l.id)]);
    setBizNextToken(outcome.page.nextPageToken ?? null);
    setBizDuplicates((prev) => prev + (outcome.page.duplicates ?? 0));
  }

  function retryBizRequest() {
    if (bizRetry === "more") void handleBizLoadMore();
    else void handleBizSearch();
  }

  /** Optimistic status change; the server's tags replace the guess, and a failure rolls it back. */
  async function handleBusinessStatus(id: string, status: LeadStatus) {
    const before = leads.find((l) => l.id === id)?.tags ?? null;
    const optimistic = tagsWithStatus(before, status);
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, tags: optimistic } : l)));
    try {
      const res = await fetch("/api/agents/leads/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't update the status.");
      const saved = Array.isArray(data.tags) ? (data.tags as string[]) : optimistic;
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, tags: saved } : l)));
    } catch (err) {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, tags: before } : l)));
      show(err instanceof Error ? err.message : "Couldn't update the status.");
    }
  }

  function openBusinessEmail(lead: BusinessLead) {
    const full = leads.find((l) => l.id === lead.id);
    if (full) setBizEmailLead(full);
  }

  async function handleRemove(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    try {
      await fetch(`/api/agents/leads/search?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      show("Failed to remove lead — it may still be saved.");
      loadLeads();
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!open) {
    return (
      <CollapsedRail onExpand={onToggle}>
        <RailButton icon={<Users size={15} />} label="Leads" onClick={onToggle} />
      </CollapsedRail>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
          <Users size={15} className="text-gray-500" />
          Leads
          {(mode === "business" ? businessLeads.length : personLeads.length) > 0 && (
            <span className="text-[11px] font-normal text-gray-400">({mode === "business" ? businessLeads.length : personLeads.length})</span>
          )}
        </div>
        <button onClick={onToggle} title="Collapse" className="hidden text-gray-400 hover:text-gray-700 md:block">
          <ChevronLeft size={15} />
        </button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-gray-200 p-3">
        <div className="mb-1 flex rounded-lg bg-gray-100 p-0.5 text-[12px]">
          <button
            onClick={() => setMode("person")}
            className={`flex-1 rounded-md py-1.5 font-medium ${mode === "person" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            People
          </button>
          <button
            onClick={() => setMode("business")}
            className={`flex-1 rounded-md py-1.5 font-medium ${mode === "business" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            Local Business
          </button>
        </div>

        {mode === "person" ? (
          <>
            {leadProfile.isLoading ? (
              <SkeletonCard rows={3} />
            ) : leadProfile.isError ? (
              <p className="text-[11px] text-amber-600">⚠ Couldn&apos;t load your lead profile. Try again in a moment.</p>
            ) : leadProfile.confirmed && leadProfile.profile ? (
              <>
                <LeadProfileSearch
                  key={leadProfile.profile.confirmedAt}
                  profile={leadProfile.profile}
                  searching={searching}
                  disabled={!project}
                  onEdit={() => setWizardOpen(true)}
                  onSearch={(target) => handleSearch({ ...target, useProfile: true })}
                />
                <details className="group rounded-lg border border-gray-100 px-2.5 py-1.5">
                  <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-gray-800">Custom search</summary>
                  <div className="mt-2 space-y-2">
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Role — e.g. VP Marketing"
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
                />
                <input
                  value={companyOrIndustry}
                  onChange={(e) => setCompanyOrIndustry(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Company or industry — e.g. B2B SaaS"
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
                />
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Location — e.g. Austin, TX"
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
                />
                <button
                  onClick={() => handleSearch()}
                  disabled={searching || !project}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#111111] py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
                >
                  {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                  {searching ? "Searching..." : "Search Leads"}
                </button>
                  </div>
                </details>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 p-4 text-center">
                <Users size={18} className="mx-auto mb-2 text-gray-300" />
                <p className="text-[13px] font-semibold text-gray-900">Tell us who you sell to</p>
                <p className="mx-auto mt-1 max-w-[240px] text-[12px] leading-4 text-gray-500">
                  A two-minute profile so every lead fits your product, not just a job title.
                </p>
                <button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  disabled={!project}
                  className="mt-3 rounded-lg bg-[#111111] px-4 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
                >
                  Set up lead profile
                </button>
              </div>
            )}
          </>
        ) : (
          <BusinessSearchForm
            category={bizCategory}
            location={bizLocation}
            onCategoryChange={setBizCategoryInput}
            onLocationChange={setBizLocationInput}
            fromProfile={bizFromProfile}
            hasProfile={Boolean(confirmedProfile)}
            onEditProfile={() => {
              setMode("person");
              setWizardOpen(true);
            }}
            searching={searching}
            disabled={!project}
            onSearch={handleBizSearch}
            showKeyHint={!FEATURES.PLATFORM_MODE && !googleCloudConnected}
          />
        )}
      </div>

      <GmailOutreachBar />

      {showWizard && mode === "person" && (
        <LeadProfileWizard
          key={leadProfile.profile ? "edit" : "new"}
          open
          onClose={closeWizard}
          initial={leadProfile.profile ?? leadProfile.suggestion}
          saving={leadProfile.save.isPending}
          error={leadProfile.save.error instanceof Error ? leadProfile.save.error.message : null}
          onConfirm={confirmProfile}
        />
      )}

      {selected.size > 0 && (
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-[12px] text-gray-600">{selected.size} selected</span>
          <button
            onClick={() => setComposeOpen(true)}
            disabled={!gmail.canSend}
            title={gmail.canSend ? "Compose an outreach email" : "Connect Gmail above first"}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
              gmail.canSend ? "border-gray-200 text-gray-700 hover:bg-gray-100" : "border-gray-200 text-gray-400"
            }`}
          >
            <Mail size={11} /> Email Selected
          </button>
        </div>
      )}

      {composeOpen && (
        <ComposeEmailModal
          leads={leads.filter((l) => selected.has(l.id))}
          onClose={() => setComposeOpen(false)}
          onSent={(results) => {
            const byId = new Map(results.map((r) => [r.id, r]));
            setLeads((prev) =>
              prev.map((l) => {
                const r = byId.get(l.id);
                if (!r) return l;
                return { ...l, email_status: r.status, emailed_at: r.status === "sent" ? new Date().toISOString() : l.emailed_at };
              })
            );
            const sentCount = results.filter((r) => r.status === "sent").length;
            show(`Sent ${sentCount} of ${results.length} email${results.length === 1 ? "" : "s"}.`);
            setSelected(new Set());
          }}
        />
      )}

      {followUpDraft && (
        <ComposeEmailModal
          leads={leads.filter((l) => l.id === followUpDraft.leadId)}
          initialSubject={followUpDraft.subject}
          initialBody={followUpDraft.body}
          onClose={() => setFollowUpDraft(null)}
          onSent={(results) => {
            const sent = results.find((r) => r.status === "sent");
            show(sent ? "Follow-up sent." : "Failed to send follow-up.");
            setFollowUpDraft(null);
          }}
        />
      )}

      {bizEmailLead && (
        <ComposeEmailModal
          leads={[bizEmailLead]}
          onClose={() => setBizEmailLead(null)}
          onSent={(results) => {
            const r = results.find((x) => x.id === bizEmailLead.id);
            if (r) {
              setLeads((prev) =>
                prev.map((l) =>
                  l.id === r.id ? { ...l, email_status: r.status, emailed_at: r.status === "sent" ? new Date().toISOString() : l.emailed_at } : l
                )
              );
            }
            show(r?.status === "sent" ? "Email sent." : "Failed to send the email.");
          }}
        />
      )}

      <div className="okara-scroll flex-1 overflow-y-auto">
        {!project ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Users size={18} className="text-gray-300" />
            <p className="text-[13px] text-gray-500">Link a website first to search for leads.</p>
          </div>
        ) : loading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : mode === "business" ? (
          <BusinessResults
            searching={searching}
            searched={bizSearched}
            results={bizResults}
            saved={bizSaved}
            nextPageToken={bizNextToken}
            duplicates={bizDuplicates}
            loadingMore={bizLoadingMore}
            error={bizError}
            showStatus={FEATURES.PLATFORM_MODE}
            canEmail={gmail.canSend}
            onRetry={retryBizRequest}
            onLoadMore={handleBizLoadMore}
            onRemove={handleRemove}
            onEmail={openBusinessEmail}
            onStatusChange={handleBusinessStatus}
          />
        ) : personLeads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Search size={18} className="text-gray-300" />
            <p className="text-[13px] font-medium text-gray-700">No leads yet</p>
            <p className="max-w-[220px] text-[12px] text-gray-500">
              Search by role, company, or location above — real people pulled from real web search
              results, never invented.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {personLeads.map((lead) => (
              <div key={lead.id} className="group flex gap-2.5 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(lead.id)}
                  onChange={() => toggleSelected(lead.id)}
                  className="mt-1 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-gray-900">{lead.name}</span>
                    <button
                      onClick={() => handleRemove(lead.id)}
                      className="shrink-0 text-gray-300 opacity-0 hover:text-gray-600 group-hover:opacity-100"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  {(lead.title || lead.company) && (
                    <div className="truncate text-[12px] text-gray-600">
                      {[lead.title, lead.company].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {lead.location && <div className="truncate text-[11px] text-gray-400">{lead.location}</div>}
                  {lead.phone && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-600">
                      <Phone size={10} /> {lead.phone}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    {lead.lead_type === "business" ? null : lead.email ? (
                      <span
                        title={lead.email_verified ? "SMTP-verified guess — not found directly, but the mail server accepted it" : "Found directly in real search results"}
                        className="rounded-full bg-[#e6f7f4] px-2 py-0.5 font-medium text-[#00846f]"
                      >
                        {lead.email}
                        {!!lead.email_verified && " ✓ verified"}
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-400">No email found</span>
                    )}
                    {websiteHref(lead.source_url) && (
                      <a
                        href={websiteHref(lead.source_url) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-0.5 text-gray-400 hover:text-gray-700"
                      >
                        {lead.lead_type === "business" ? "Website" : "Source"} <ExternalLink size={10} />
                      </a>
                    )}
                    {lead.email_status === "sent" && (
                      <span className="flex items-center gap-0.5 text-[#00846f]">
                        <Mail size={10} /> Sent
                      </span>
                    )}
                    {lead.email_status === "failed" && <span className="text-red-600">⚠ Send failed</span>}
                    {lead.last_reply_snippet && (
                      <span className="flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">
                        <Reply size={10} /> Replied
                      </span>
                    )}
                  </div>
                  {lead.last_reply_snippet && (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="truncate text-[11px] text-blue-700">&ldquo;{lead.last_reply_snippet}&rdquo;</p>
                      <button
                        onClick={() => handleDraftFollowUp(lead)}
                        disabled={draftingFollowUp === lead.id}
                        className="shrink-0 flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {draftingFollowUp === lead.id ? <Loader2 size={9} className="animate-spin" /> : <Reply size={9} />}
                        Draft follow-up
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-4 py-2.5 text-[11px] text-gray-400">
        <span>Emails are found in real search results or SMTP-verified — never shown unverified.</span>
        <div className="flex items-center gap-3">
          {gmail.canRead && (
            <button
              onClick={handleCheckReplies}
              disabled={checkingReplies}
              title="Poll Gmail for real replies on sent threads"
              className="flex items-center gap-1 hover:text-gray-700 disabled:opacity-50"
            >
              {checkingReplies ? <Loader2 size={11} className="animate-spin" /> : <Reply size={11} />}
              {checkingReplies ? "Checking..." : "Check replies"}
            </button>
          )}
          <button onClick={loadLeads} className="flex items-center gap-1 hover:text-gray-700">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
