"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useTerminalLog } from "./terminal-log-store";
import { useProviders, findProviderForModel } from "./providers-store";
import { FEATURES } from "./features";
import {
  assessGeneratedDocument,
  blockedBy,
  finalSetupLine,
  isSetupRunning,
  settleSetupRun,
  summarizeDocumentRun,
  type DocKey,
  type DocOutcome,
} from "./domain/project/setupRun";
import {
  SETUP_STEPS,
  WAITING_PREFIX,
  SETUP_STEP_LABELS,
  anyFreshRunning,
  isUnfinished,
  nextStepsToRun,
  summarizeSetup,
  type SetupState,
  type SetupStatus,
  type SetupStepKey,
} from "./domain/project/setupState";
import { fetchSetupView, recordSetupStep } from "./setup-client";
import { createClient } from "@/utils/supabase/client";
import { fetchWithTimeout, DEFAULT_FETCH_TIMEOUT_MS } from "@/lib/query/fetchJson";

export type ActiveProject = {
  id: string;
  name: string;
  category: string;
  description: string;
  url: string;
  updated_at: string;
};

type Ctx = {
  project: ActiveProject | null;
  /** All saved projects (real multi-project — see /api/project), newest
   * first. Powers the project switcher's dropdown list. */
  projects: ActiveProject[];
  loading: boolean;
  /** True only once GET /api/project answered successfully with a project list (possibly empty).
   * False while loading, after a failed/unauthorized/network error, and after sign-out, so "no
   * projects" can be trusted as "new user" only when this is true. */
  projectsLoaded: boolean;
  /** True while the active project's setup run is in flight (crawl, description,
   * competitors, leads, and the background documents). Context hides its
   * "Finish setup" card and Analytics disables re-running the audit meanwhile. */
  setupRunning: boolean;
  /** Persisted per-step setup progress for the active project (null until loaded, or when it cannot be read).
   * Drives the Context "Finish setup" card. */
  setupState: SetupState | null;
  /** Runs one setup step again (plus the steps that were waiting on it) through the same code as first-run setup. */
  retrySetupStep: (step: SetupStepKey) => Promise<void>;
  /** Creates a NEW project, makes it active, saves it, triggers a real SEO
   * crawl of the URL, and logs real progress lines to the shared terminal
   * log — same flow whether called from the top project switcher or
   * anywhere else. */
  createProject: (input: { name: string; url: string; category?: string; description?: string }) => Promise<void>;
  /** Switches which saved project is active — Context, Analytics, and every
   * agent immediately start reading this one's data instead. */
  switchProject: (id: string) => Promise<void>;
  /** Real edit — name/category/description/url. A URL change is
   * re-validated server-side the same way project creation is. */
  updateProject: (id: string, input: { name?: string; category?: string; description?: string; url?: string }) => Promise<void>;
  /** Real delete — wipes every table scoped to this project (documents,
   * competitors, cached checks, leads) server-side. If this was the active
   * project, the most-recently-updated remaining one becomes active. */
  deleteProject: (id: string) => Promise<void>;
  /** Bumped after auto-discovery adds competitors post-creation — ContextPanel
   * watches this to refresh its competitor list without polling. */
  competitorsVersion: number;
  /** Bumped once the automatic post-creation SEO crawl actually finishes.
   * `project.url` changes the instant the project is created — well before
   * the crawl (awaited afterward) completes — so anything that refetches
   * only on `project.url` (e.g. AnalyticsPanel) would fetch too early and
   * see no audit yet, with no signal telling it to try again. This is that
   * signal. */
  auditVersion: number;
  /** Bumped as each auto-generated Context document is saved. Generation now
   * runs un-awaited in the background, so it finishes AFTER onboarding calls
   * the dashboard's refresh() — without this signal the documents would sit
   * in the database unseen until a manual reload. */
  documentsVersion: number;
  /** Bumped once the free, platform-only post-creation lead auto-generation
   * finishes — LeadsPanel watches this to refresh without polling. Always 0
   * on self-host (the feature never runs there). */
  leadsVersion: number;
  /** Call after a manual audit re-run (e.g. Context's "Finish setup" retry) so
   * panels keyed on auditVersion, like Analytics, refetch. */
  notifyAuditChanged: () => void;
};

/** found: competitors added. none: ran fine, nothing confident. failed: errored.
 * off: the Settings toggle disables auto-discovery. */
type CompetitorOutcome = "found" | "none" | "failed" | "off";

/** Runs right after a successful crawl during project creation — real
 * competitor discovery (see CompetitorDiscoveryAgent), gated by the Settings
 * toggle (default on) and requiring a connected model. Never throws: a
 * failure here shouldn't block the rest of project setup, it just logs and
 * moves on — competitors can always be found/added manually afterward. */
async function maybeDiscoverCompetitors(
  projectId: string,
  log: (text: string) => void,
  primaryModel: string | null,
  onAdded: () => void
): Promise<CompetitorOutcome> {
  try {
    const settingsRes = await fetch("/api/settings");
    const settingsData = await settingsRes.json();
    const toggle = settingsData.settings?.find((s: { key: string; value: string }) => s.key === "auto_discover_competitors");
    if (toggle?.value === "0") return "off";

    // A model is optional: a small web search based on the product finds the
    // competitors on its own, and a connected model only refines the result.
    const providerId = primaryModel ? findProviderForModel(primaryModel) : null;

    log("Looking for real competitors...");
    // Explicit projectId — this runs as a background continuation after
    // creation's crawl, which can take a while. Without pinning the target
    // here, a project switch/creation that happens to land in the meantime
    // would make the route's getActiveProjectId() resolve to whichever
    // project is active BY THE TIME this call reaches the server, silently
    // attaching these competitors to the wrong project.
    const res = await fetch("/api/project/competitors/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: primaryModel ?? undefined, providerId: providerId ?? undefined, projectId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      log(`Couldn't auto-discover competitors (${err.error ?? "unknown error"}) — add them manually in the Context panel.`);
      return "failed";
    }

    const data = await res.json();
    const added: { url: string }[] = data.added ?? [];
    if (added.length === 0) {
      log(
        data.usedWebSearch
          ? "No confident competitors found yet — add some manually in the Context panel."
          : "No Tavily key connected, so I only had existing site data to go on — no confident competitors found. Add some manually, or connect Tavily in Settings for deeper discovery."
      );
      return "none";
    }

    const names = added.map((a) => a.url.replace(/^https?:\/\//, "")).join(", ");
    log(
      `${data.usedWebSearch ? "Searched the web and found" : "Based on your site's own content, found"} ${added.length} real competitor${added.length === 1 ? "" : "s"}: ${names}.`
    );
    onAdded();
    return "found";
  } catch {
    log("Couldn't reach the competitor discovery service — add competitors manually in the Context panel.");
    return "failed";
  }
}

/** Same stream → accumulate → POST /save shape as DocumentPanel.tsx's
 * handleGenerate — every /api/project/documents/<doc>/route.ts POST always
 * streams (see e.g. ProductInfoGenerator.generate's stream: true), so
 * nothing is persisted until whoever reads the stream saves it, exactly
 * like a user manually clicking "Generate" in the Context panel would.
 * Runs sequentially by design (not Promise.all): several docs are
 * grounded in an earlier one (Marketing Strategy reads Product Info,
 * Content Strategy reads all three, Design Guide reads Marketing
 * Strategy) — see each Generator's own comments — so generating them out
 * of order would silently produce weaker, ungrounded documents. */
async function generateAndSaveDocument(
  apiPath: string,
  title: string,
  model: string,
  providerId: string,
  log: (text: string) => void
): Promise<boolean> {
  const base = `/api/project/documents/${apiPath}`;
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, providerId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      log(`Couldn't auto-generate ${title} (${data.error ?? "unknown error"}) — generate it manually in the Context panel.`);
      return false;
    }

    // A route whose generator does not stream answers JSON ({ text }) and has
    // already saved the document itself; saving the raw JSON body would store
    // `{"text":...}` as the document.
    if ((res.headers.get("content-type") ?? "").includes("application/json")) {
      await res.json().catch(() => ({}));
      log(`${title} ready.`);
      return true;
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    let finalContent = "";
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        finalContent += decoder.decode(value, { stream: true });
      }
    }

    // Never overwrite a saved document with an empty or truncated stream.
    const check = assessGeneratedDocument(finalContent);
    if (!check.ok) {
      log(`Couldn't auto-generate ${title} (${check.reason}) — your existing document, if any, was kept. Generate it manually in the Context panel.`);
      return false;
    }

    const saveRes = await fetch(`${base}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: finalContent }),
    });
    if (!saveRes.ok) {
      const data = await saveRes.json().catch(() => ({}));
      log(`Generated ${title} but couldn't save it (${data.error ?? `HTTP ${saveRes.status}`}) — generate it again from the Context panel.`);
      return false;
    }
    log(`${title} ready.`);
    return true;
  } catch {
    log(`Couldn't auto-generate ${title} — generate it manually in the Context panel.`);
    return false;
  }
}

/** Confirms `projectId` is still the server's active project.
 *
 * Every /api/project/documents/<doc> route resolves its target by reading
 * active_project_id server-side at request time and accepts no projectId
 * override (unlike competitors/discover, which takes one explicitly).
 * Auto-generation runs for minutes after creation, so if the user creates
 * or switches projects in the meantime, the remaining documents would be
 * written against whichever project is active by then — silently
 * attaching this project's Product Info to a different site.
 *
 * Checking before each document turns that silent corruption into a clean
 * stop. It's a narrow race (the check and the generate aren't atomic), but
 * it closes the realistic minutes-wide window rather than the millisecond
 * one, without rewriting six route contracts. */
async function stillActiveProject(projectId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/project");
    if (!res.ok) return false;
    const data = await res.json();
    return data.project?.id === projectId;
  } catch {
    return false;
  }
}

/** Competitor Comparison doesn't follow generateAndSaveDocument's
 * contract: its POST route upserts into project_documents itself and
 * streams back a small confirmation, with no /save endpoint to call
 * afterwards (CompetitorComparisonPanel.tsx's handleGenerate does the
 * same — POST, then re-read). Calling /save for it would 404. */
async function generateSelfSavingDocument(
  apiPath: string,
  title: string,
  model: string,
  providerId: string,
  log: (text: string) => void
): Promise<boolean> {
  try {
    const res = await fetch(`/api/project/documents/${apiPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, providerId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      log(`Couldn't auto-generate ${title} (${data.error ?? "unknown error"}) — generate it manually in the Context panel.`);
      return false;
    }

    // Drain the stream so the request completes before the next one starts.
    await res.text();
    log(`${title} ready.`);
    return true;
  } catch {
    log(`Couldn't auto-generate ${title} — generate it manually in the Context panel.`);
    return false;
  }
}

const DOC_STEP_TITLES: Record<DocKey, string> = {
  "product-info": "Product Information",
  "marketing-strategy": "Marketing Strategy",
  "competitor-analysis": "Competitor Analysis",
  "competitor-comparison": "Competitor Comparison",
  "content-strategy": "Content Strategy",
  "design-guide": "Design Guide",
};
const DOC_STEP_ORDER = Object.keys(DOC_STEP_TITLES) as DocKey[];
const isDocStep = (k: SetupStepKey): k is DocKey => (DOC_STEP_ORDER as string[]).includes(k);

/** How a run talks to the persisted setup state. Recording is fire-and-forget
 * (a failure to record never breaks setup); only `claim` can stop a run, and
 * only the resume path makes it wait for the server's answer. */
type SetupHooks = {
  /** Marks `step` running. False = another tab owns it, so this run must stop. */
  claim: (step: SetupStepKey) => Promise<boolean>;
  settle: (step: SetupStepKey, status: SetupStatus, error?: string) => void;
};

/** Generates the Context documents in `only`, in the grounding order the manual
 * flow relies on: Product Info first, then Marketing Strategy (reads Product
 * Info), then the two competitor documents (only if at least one competitor
 * exists), then Content Strategy, then Design Guide. One failing document does
 * not stop the rest, except its dependents (see blockedBy). Documents outside
 * `only` are taken from `prior` so dependents still see a failed source. */
async function autoGenerateContextDocuments(
  projectId: string,
  primaryModel: string | null,
  hasCompetitors: boolean,
  log: (text: string) => void,
  logDone: (text: string) => void,
  onSaved: () => void,
  /** Problems already found earlier in setup (crawl, description...). The
   * final "Setup complete" / "Setup finished with problems" line is written
   * here because this is the last step to finish. */
  priorProblems: string[],
  only: Set<DocKey>,
  prior: Partial<Record<SetupStepKey, SetupStatus>>,
  hooks: SetupHooks
): Promise<void> {
  const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
  if (!primaryModel || !providerId) {
    log("Skipping auto-generated context documents — connect a model in Settings to enable it.");
    for (const k of DOC_STEP_ORDER) if (only.has(k)) hooks.settle(k, "failed", "connect a model in Settings");
    const last = finalSetupLine([...priorProblems, "no documents (connect a model in Settings)"]);
    log(`⚠ ${last.text}`);
    return;
  }

  /** Bails out if the user switched/created a project mid-run — see
   * stillActiveProject. Returning false stops the remaining documents. */
  const guard = async (): Promise<boolean> => {
    if (await stillActiveProject(projectId)) return true;
    log("Stopped writing context documents — you switched to another project. Generate them from the Context panel when you're back.");
    return false;
  };

  const outcomes: DocOutcome[] = [];
  for (const k of DOC_STEP_ORDER) {
    if (only.has(k)) continue;
    const was = prior[k];
    outcomes.push({ key: k, title: DOC_STEP_TITLES[k], status: was === "done" ? "ready" : was === "skipped" ? "skipped" : "failed" });
  }
  let stopped = false;

  /** Runs one document unless a prerequisite failed (then it is left waiting and
   * the reason is logged), records the outcome, and bumps documentsVersion on a
   * real save so the Context panel picks it up. */
  const step = async (key: DocKey, run: () => Promise<boolean>): Promise<void> => {
    if (!only.has(key) || stopped) return;
    const title = DOC_STEP_TITLES[key];
    const blocker = blockedBy(key, outcomes);
    if (blocker) {
      log(`Skipping ${title} — ${blocker} didn't finish, and ${title} is written from it. Retry ${blocker} in the Context panel first.`);
      outcomes.push({ key, title, status: "blocked" });
      hooks.settle(key, "pending", `${WAITING_PREFIX}${blocker}`);
      return;
    }
    if (!(await hooks.claim(key))) {
      stopped = true;
      return;
    }
    const ok = await run();
    if (ok) onSaved();
    outcomes.push({ key, title, status: ok ? "ready" : "failed" });
    hooks.settle(key, ok ? "done" : "failed", ok ? undefined : "generation failed");
  };
  const generate = (key: DocKey) =>
    step(key, () => generateAndSaveDocument(key, DOC_STEP_TITLES[key], primaryModel, providerId, log));
  /** True to carry on to the next document. */
  const proceed = async (key: DocKey): Promise<boolean> => (only.has(key) && !stopped ? guard() : !stopped);

  log(`Writing your Context documents — ${DOC_STEP_ORDER.filter((k) => only.has(k)).map((k) => DOC_STEP_TITLES[k]).join(", ")}...`);
  await generate("product-info");
  if (!(await proceed("product-info"))) return;
  await generate("marketing-strategy");
  if (!(await proceed("marketing-strategy"))) return;
  if (hasCompetitors) {
    await generate("competitor-analysis");
    if (!(await proceed("competitor-analysis"))) return;
    await step("competitor-comparison", () =>
      generateSelfSavingDocument("competitor-comparison", "Competitor Comparison", primaryModel, providerId, log)
    );
    if (!(await proceed("competitor-comparison"))) return;
  } else {
    for (const k of ["competitor-analysis", "competitor-comparison"] as const) {
      if (!only.has(k)) continue;
      outcomes.push({ key: k, title: DOC_STEP_TITLES[k], status: "skipped" });
      hooks.settle(k, "skipped");
    }
    if (only.has("competitor-analysis") || only.has("competitor-comparison")) {
      log("Skipping Competitor Analysis and Competitor Comparison — no competitors found or added yet.");
    }
  }
  await generate("content-strategy");
  if (!(await proceed("content-strategy"))) return;
  await generate("design-guide");
  if (stopped) return;

  const summary = summarizeDocumentRun(outcomes);
  if (summary.hasProblems) log(`⚠ ${summary.text}`);
  else logDone(`Context documents: ${summary.text} Review and edit anytime in the Context panel.`);

  const problems = [...priorProblems];
  if (summary.hasProblems) problems.push(summary.text.replace(/: open Context to retry\.$/, ""));
  const last = finalSetupLine(problems);
  if (last.ok) logDone(last.text);
  else log(`⚠ ${last.text}`);
}

type SetupRunCtx = {
  project: { id: string; url: string; description: string };
  primaryModel: string | null;
  /** Status of every step before this run (a fresh project: all pending). */
  prior: Record<SetupStepKey, SetupStatus>;
  hooks: SetupHooks;
  log: (text: string) => void;
  logDone: (text: string) => void;
  /** Whether the project has competitors, asked only when this run skips the competitors step. */
  loadHasCompetitors: () => Promise<boolean>;
  onAudit: () => void;
  onDescription: (description: string) => void;
  /** The crawl found the real brand name and the server renamed the auto-named project. */
  onRenamed?: (name: string) => void;
  onCompetitors: () => void;
  onLeads: () => void;
  onDocSaved: () => void;
};

/** Runs `steps` (a subset of SETUP_STEPS, in order). Used by project creation
 * (all steps) and by resume/retry (the missing ones). The core steps are
 * awaited; the documents are returned as a promise so creation can leave them
 * running in the background. Every step records its transition via hooks. */
async function runSetupSteps(ctx: SetupRunCtx, steps: SetupStepKey[]): Promise<{ docs: Promise<void> | null }> {
  const { project, hooks, log, logDone, primaryModel } = ctx;
  const want = new Set(steps);
  const problems: string[] = [];
  let auditOk = ctx.prior.audit === "done";

  if (want.has("audit")) {
    if (!(await hooks.claim("audit"))) return { docs: null };
    try {
      const auditRes = await fetch("/api/agents/seo/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: project.url, quick: true }),
      });
      if (auditRes.ok) {
        auditOk = true;
        hooks.settle("audit", "done");
        ctx.onAudit();
        const audit = await auditRes.json().catch(() => ({}));
        if (typeof audit.projectRenamed === "string") ctx.onRenamed?.(audit.projectRenamed);
        log(
          audit.meta?.title
            ? `Found it: "${audit.meta.title}". Context, Analytics, and agents now have real data to work from.`
            : "Crawled the site. Context, Analytics, and agents now have real data to work from."
        );
      } else {
        const err = await auditRes.json().catch(() => ({}));
        log(`Couldn't fully crawl the site (${err.error ?? "unknown error"}) — agents will still use the URL directly.`);
        problems.push("the site crawl failed, so there is no audit yet");
        hooks.settle("audit", "failed", String(err.error ?? `HTTP ${auditRes.status}`));
      }
    } catch {
      log("Couldn't reach the crawl service — agents will still use the URL directly.");
      problems.push("the site crawl could not be reached, so there is no audit yet");
      hooks.settle("audit", "failed", "crawl service unreachable");
    }
  }

  if (!auditOk) {
    // Everything else is written from the crawl: nothing more runs, the outcome is known now.
    const last = finalSetupLine(problems.length ? problems : ["the site audit has not run"]);
    log(`⚠ ${last.text}`);
    return { docs: null };
  }

  if (want.has("description")) {
    const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
    if (project.description.trim()) {
      // The user wrote their own description: never overwrite it with a generated one.
      hooks.settle("description", "done");
    } else if (primaryModel && providerId) {
      if (!(await hooks.claim("description"))) return { docs: null };
      try {
        log("Writing a real description from what's actually on the page...");
        const descRes = await fetch(`/api/project/${project.id}/generate-description`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: primaryModel, providerId }),
        });
        if (descRes.ok) {
          const { description } = await descRes.json();
          ctx.onDescription(description);
          hooks.settle("description", "done");
          logDone(`Description: "${description}"`);
        } else {
          const err = await descRes.json().catch(() => ({}));
          log(`Couldn't write a description (${err.error ?? `HTTP ${descRes.status}`}) — generate it from Context, or edit it in Settings → Websites.`);
          problems.push("no description");
          hooks.settle("description", "failed", String(err.error ?? `HTTP ${descRes.status}`));
        }
      } catch {
        // non-fatal — description stays blank, editable manually in Settings → Websites
        log("Couldn't reach the description service — generate it from Context, or edit it in Settings → Websites.");
        problems.push("no description");
        hooks.settle("description", "failed", "description service unreachable");
      }
    } else {
      problems.push("no description (connect a model in Settings)");
      hooks.settle("description", "failed", "connect a model in Settings");
    }
  }

  let hasCompetitors = false;
  if (want.has("competitors")) {
    if (!(await hooks.claim("competitors"))) return { docs: null };
    const outcome = await maybeDiscoverCompetitors(project.id, log, primaryModel, ctx.onCompetitors);
    hasCompetitors = outcome === "found";
    hooks.settle(
      "competitors",
      outcome === "off" ? "skipped" : outcome === "failed" ? "failed" : "done",
      outcome === "failed" ? "discovery failed" : undefined
    );
  } else if (steps.some(isDocStep)) {
    hasCompetitors = await ctx.loadHasCompetitors();
  }

  if (want.has("leads")) {
    // Free, platform-only baseline (up to 10 leads) -- runs on the platform's own
    // Groq key, so it works before any LLM is connected. Self-host has none.
    if (!FEATURES.PLATFORM_MODE) {
      hooks.settle("leads", "skipped");
    } else if (await hooks.claim("leads")) {
      try {
        log("Finding real leads to kick off outreach...");
        const leadsRes = await fetch(`/api/project/${project.id}/generate-leads`, { method: "POST" });
        if (leadsRes.ok) {
          const { added, message } = await leadsRes.json();
          if (added > 0) {
            logDone(`Found ${added} real lead${added === 1 ? "" : "s"} — check the Leads panel.`);
            ctx.onLeads();
          } else {
            log(message ? `${message} Search manually in the Leads panel, or check back tomorrow.` : "No confident leads found yet — search manually in the Leads panel, or check back tomorrow.");
          }
          hooks.settle("leads", "done");
        } else {
          log("Couldn't find leads automatically — search manually in the Leads panel.");
          // 429 = the 24h window already ran for this project: nothing to retry.
          hooks.settle("leads", leadsRes.status === 429 ? "done" : "failed", leadsRes.status === 429 ? undefined : `HTTP ${leadsRes.status}`);
        }
      } catch {
        // non-fatal -- leads can always be found manually in the Leads panel
        log("Couldn't reach the lead finder — search manually in the Leads panel.");
        hooks.settle("leads", "failed", "lead finder unreachable");
      }
    } else {
      return { docs: null };
    }
  }

  const docSteps = new Set(steps.filter(isDocStep));
  if (docSteps.size === 0) {
    const last = finalSetupLine(problems);
    if (last.ok) logDone(last.text);
    else log(`⚠ ${last.text}`);
    return { docs: null };
  }
  return {
    docs: autoGenerateContextDocuments(project.id, primaryModel, hasCompetitors, log, logDone, ctx.onDocSaved, problems, docSteps, ctx.prior, hooks),
  };
}

const ProjectCtx = createContext<Ctx | null>(null);

export function useProject() {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}

export default function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [project, setProject] = useState<ActiveProject | null>(null);
  const [projects, setProjects] = useState<ActiveProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [competitorsVersion, setCompetitorsVersion] = useState(0);
  const [auditVersion, setAuditVersion] = useState(0);
  const [documentsVersion, setDocumentsVersion] = useState(0);
  const [leadsVersion, setLeadsVersion] = useState(0);
  /** Project whose setup run is in flight. See settleSetupRun / isSetupRunning. */
  const [setupRunningId, setSetupRunningId] = useState<string | null>(null);
  const projectRef = useRef<ActiveProject | null>(null);
  const primaryModelRef = useRef<string | null>(null);
  /** Project whose setup this TAB is running (synchronous twin of setupRunningId). */
  const runningHere = useRef<string | null>(null);
  /** Project the auto-resume check already ran for in this tab (reset when it is worth re-checking). */
  const attemptedFor = useRef<string | null>(null);
  const remoteRef = useRef(false);
  const lastDoneRef = useRef(-1);
  const [setupInfo, setSetupInfo] = useState<{ projectId: string; state: SetupState; remote: boolean } | null>(null);
  const { log, logDone } = useTerminalLog();
  const { primaryModel, loading: providersLoading } = useProviders();

  const notifyAuditChanged = useCallback(() => setAuditVersion((v) => v + 1), []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchWithTimeout("/api/project");
      let data = await res.json();
      // Projects exist but none is active (pointer lost/cleared): activate the
      // newest instead of leaving the user with a dashboard that reports
      // "No active project" (and, formerly, the new-user onboarding modal).
      if (!data.project && Array.isArray(data.projects) && data.projects.length > 0) {
        const switched = await fetchWithTimeout("/api/project/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: data.projects[0].id }),
          timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
        }).catch(() => null);
        if (switched?.ok) data = await fetchWithTimeout("/api/project").then((r) => r.json());
      }
      setProject(data.project ?? null);
      setProjects(data.projects ?? []);
      // Only a successful answer with a real list proves "no projects"; a 401/500 body must not.
      setProjectsLoaded(res.ok && Array.isArray(data.projects));
    } catch {
      // backend unreachable — leave project as-is, UI shows empty/setup state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // refresh() is an async fetch-on-mount: its setState calls run in promise
    // callbacks after an await, not synchronously in the effect body, so the
    // cascading render this rule guards against can't happen here. Pre-existing
    // on main; surfaced only because editing this file pulls it into CI's
    // changed-files lint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // This provider sits in the root layout and fetches /api/project once while
  // the visitor may still be logged out; login navigates client-side, so it is
  // not remounted. Re-read on sign-in, and forget the account's projects on
  // sign-out so the next user never sees them.
  useEffect(() => {
    let mounted = true;
    const { data: authListener } = createClient().auth.onAuthStateChange((event) => {
      if (!mounted) return;
      if (event === "SIGNED_IN") void refresh();
      if (event === "SIGNED_OUT") {
        setProject(null);
        setProjects([]);
        setProjectsLoaded(false);
        setSetupRunningId(null);
        setSetupInfo(null);
        runningHere.current = null;
        attemptedFor.current = null;
        remoteRef.current = false;
      }
    });
    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [refresh]);

  // ---- Persisted setup state: resume after a reload or a closed tab -------------------------

  useEffect(() => {
    projectRef.current = project;
    primaryModelRef.current = primaryModel;
  }, [project, primaryModel]);

  /** Re-reads the persisted state. `remote` = a step is running that this tab does not own. */
  const reloadSetup = useCallback(async (projectId: string) => {
    const view = await fetchSetupView(projectId);
    if (!view || projectRef.current?.id !== projectId) return null;
    const now = new Date(view.serverTime);
    const remote = runningHere.current !== projectId && anyFreshRunning(view.state, now);
    const wasRemote = remoteRef.current;
    if (wasRemote && !remote) attemptedFor.current = null; // the other tab finished or died: worth re-checking
    remoteRef.current = remote;
    const done = view.summary.done;
    if ((wasRemote || remote) && done !== lastDoneRef.current) {
      // Another tab is writing: pick up what it saved.
      setAuditVersion((v) => v + 1);
      setCompetitorsVersion((v) => v + 1);
      setDocumentsVersion((v) => v + 1);
      setLeadsVersion((v) => v + 1);
      if (view.state.steps.description.status === "done") void refresh();
    }
    lastDoneRef.current = done;
    setSetupInfo({ projectId, state: view.state, remote });
    return view;
  }, [refresh]);

  const buildRunCtx = useCallback(
    (p: { id: string; url: string; description: string }, prior: Record<SetupStepKey, SetupStatus>, awaitClaims: boolean): SetupRunCtx => ({
      project: p,
      primaryModel: primaryModelRef.current,
      prior,
      hooks: {
        // Recording never blocks the chain: only a resume waits for the server's answer to a claim, so two tabs cannot both run a step.
        claim: async (step) => {
          const recorded = recordSetupStep(p.id, step, "running");
          return awaitClaims ? (await recorded) !== "conflict" : true;
        },
        settle: (step, status, error) => {
          void recordSetupStep(p.id, step, status, error);
        },
      },
      log,
      logDone,
      loadHasCompetitors: async () => {
        try {
          const res = await fetch("/api/project/competitors");
          const body = await res.json();
          return Array.isArray(body.competitors) && body.competitors.length > 0;
        } catch {
          return false;
        }
      },
      onAudit: () => setAuditVersion((v) => v + 1),
      onRenamed: (name) => {
        setProject((prev) => (prev && prev.id === p.id ? { ...prev, name } : prev));
        setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, name } : x)));
      },
      onDescription: (description) => {
        setProject((prev) => (prev && prev.id === p.id ? { ...prev, description } : prev));
        setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, description } : x)));
      },
      onCompetitors: () => setCompetitorsVersion((v) => v + 1),
      onLeads: () => setLeadsVersion((v) => v + 1),
      onDocSaved: () => setDocumentsVersion((v) => v + 1),
    }),
    [log, logDone]
  );

  /** Runs `steps` of an existing project's setup (resume or retry) and ends in a fresh read of the state. */
  const runSetupFor = useCallback(
    async (proj: ActiveProject, state: SetupState, steps: SetupStepKey[], intro: string) => {
      if (runningHere.current || steps.length === 0) return;
      runningHere.current = proj.id;
      setSetupRunningId(proj.id);
      log(intro);
      try {
        const prior = Object.fromEntries(SETUP_STEPS.map((k) => [k, state.steps[k].status])) as Record<SetupStepKey, SetupStatus>;
        const { docs } = await runSetupSteps(buildRunCtx(proj, prior, true), steps);
        if (docs) await docs;
      } catch {
        log("⚠ Setup stopped unexpectedly. Open Context to finish setup.");
      } finally {
        runningHere.current = null;
        setSetupRunningId((cur) => settleSetupRun(cur, proj.id));
        void reloadSetup(proj.id);
      }
    },
    [buildRunCtx, log, reloadSetup]
  );

  // On load and project switch: if this project's setup was started and not finished (tab closed,
  // reload), run only what is missing. A step another tab is running, fresher than STALE_RUNNING_MS,
  // is never re-run: this tab just shows "Setup is running" and polls (below).
  useEffect(() => {
    const proj = project;
    if (!proj || providersLoading) return;
    if (runningHere.current || attemptedFor.current === proj.id) return;
    attemptedFor.current = proj.id;
    void (async () => {
      const view = await reloadSetup(proj.id);
      if (!view || projectRef.current?.id !== proj.id) return;
      const now = new Date(view.serverTime);
      if (anyFreshRunning(view.state, now) || !isUnfinished(view.state, now)) return;
      const steps = nextStepsToRun(view.state, now);
      const s = summarizeSetup(view.state, now);
      await runSetupFor(proj, view.state, steps, `Resuming setup (${s.done} of ${s.total} done)...`);
    })();
  }, [project, providersLoading, setupRunningId, setupInfo?.remote, reloadSetup, runSetupFor]);

  const remoteRunning = Boolean(setupInfo && setupInfo.projectId === project?.id && setupInfo.remote);
  useEffect(() => {
    if (!remoteRunning || !project) return;
    const id = project.id;
    log("Setup is running in another tab — I'll show its progress here.");
    const timer = setInterval(() => void reloadSetup(id), 5000);
    return () => clearInterval(timer);
  }, [remoteRunning, project, log, reloadSetup]);

  /** Card "Retry"/"Run": runs one step (and the steps that were waiting on it) through the same code as setup. */
  const retrySetupStep = useCallback(
    async (key: SetupStepKey) => {
      const proj = projectRef.current;
      if (!proj || runningHere.current) return;
      const view = await fetchSetupView(proj.id);
      if (!view) {
        log("⚠ Couldn't read setup progress. Try again in a moment.");
        return;
      }
      const now = new Date(view.serverTime);
      if (anyFreshRunning(view.state, now)) {
        log("Setup is already running — I'll show its progress here.");
        void reloadSetup(proj.id);
        return;
      }
      const next: SetupState = { ...view.state, steps: { ...view.state.steps, [key]: { status: "pending", at: view.state.updatedAt } } };
      const queue = view.state.startedAt ? nextStepsToRun(next, now) : [key];
      await runSetupFor(proj, next, queue.includes(key) ? queue : [key, ...queue], `Retrying ${SETUP_STEP_LABELS[key]}...`);
    },
    [log, reloadSetup, runSetupFor]
  );

  const createProject = useCallback(
    async (input: { name: string; url: string; category?: string; description?: string }) => {
      const displayUrl = input.url.replace(/^https?:\/\//, "");
      log(`Setting up ${input.name}...`);
      log(`Let me take a look at ${displayUrl}...`);

      const res = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        log(`⚠ ${err.error ?? "Failed to save project"}`);
        throw new Error(err.error ?? "Failed to save project");
      }

      const data = await res.json();
      const created: ActiveProject = data.project;
      // Set before the state updates below render, so the resume check never mistakes this live run for an abandoned one.
      runningHere.current = created.id;
      attemptedFor.current = created.id;
      setProject(created);
      setProjects((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
      setSetupRunningId(created.id);

      log("Starting my deep dive — crawling your pages for SEO, content, and growth signals.");

      const prior = Object.fromEntries(SETUP_STEPS.map((k) => [k, "pending"])) as Record<SetupStepKey, SetupStatus>;
      const finish = () => {
        runningHere.current = runningHere.current === created.id ? null : runningHere.current;
        setSetupRunningId((cur) => settleSetupRun(cur, created.id));
        void reloadSetup(created.id);
      };

      let docs: Promise<void> | null = null;
      try {
        ({ docs } = await runSetupSteps(buildRunCtx(created, prior, false), [...SETUP_STEPS]));
      } catch {
        log("⚠ Setup finished with problems: something went wrong while setting up. Open Context to finish setup.");
      }

      if (docs) {
        // Deliberately NOT awaited. Six documents generate sequentially and each route allows up to 60s
        // (maxDuration), so awaiting here would hold OnboardingModal's spinner for minutes before the user
        // sees the dashboard. The terminal log streams progress and the Context panel fills in behind it.
        // Errors are handled per document; the catch only covers an unexpected throw in the orchestration.
        void docs
          .catch(() => {
            log("⚠ Setup finished with problems: couldn't finish writing your context documents. Open Context to finish setup.");
          })
          .finally(finish);
        // The final "Setup complete" / "Setup finished with problems" line is written by the documents
        // step once it settles: saying "complete" here would be a claim about work still running.
        log("Core setup done — documents are being written in the background.");
        return;
      }
      // Documents will not run (crawl failed): nothing is still in flight, so the outcome is known now.
      finish();
    },
    [log, buildRunCtx, reloadSetup]
  );

  const switchProject = useCallback(
    async (id: string) => {
      const target = projects.find((p) => p.id === id);
      if (target) log(`Switching to ${target.name}...`);

      // Offline or a hung server must end in a visible failure, not a Status Log stuck on "Switching to ...".
      let res: Response;
      try {
        res = await fetchWithTimeout("/api/project/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
          timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to switch project";
        log(`⚠ Couldn't switch project. ${message}`);
        throw new Error(message);
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        log(`⚠ ${err.error ?? "Failed to switch project"}`);
        throw new Error(err.error ?? "Failed to switch project");
      }

      await refresh();
      if (target) logDone(`Now working on ${target.name}.`);
    },
    [projects, log, logDone, refresh]
  );

  const updateProject = useCallback(
    async (id: string, input: { name?: string; category?: string; description?: string; url?: string }) => {
      const res = await fetch(`/api/project/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to update project");
      }
      await refresh();
    },
    [refresh]
  );

  const deleteProject = useCallback(
    async (id: string) => {
      const target = projects.find((p) => p.id === id);
      const res = await fetch(`/api/project/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to delete project");
      }
      if (target) log(`Deleted ${target.name} and all its data.`);
      await refresh();
    },
    [projects, log, refresh]
  );

  return (
    <ProjectCtx.Provider
      value={{ project, projects, loading, projectsLoaded, setupRunning: isSetupRunning(setupRunningId, project?.id) || remoteRunning, setupState: setupInfo && setupInfo.projectId === project?.id ? setupInfo.state : null, retrySetupStep, createProject, switchProject, updateProject, deleteProject, competitorsVersion, auditVersion, documentsVersion, leadsVersion, notifyAuditChanged }}
    >
      {children}
    </ProjectCtx.Provider>
  );
}
