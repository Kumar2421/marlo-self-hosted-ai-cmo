"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
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
import { createClient } from "@/utils/supabase/client";

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
  /** True while the active project's setup run is in flight (crawl, description,
   * competitors, leads, and the background documents). Context hides its
   * "Finish setup" card and Analytics disables re-running the audit meanwhile. */
  setupRunning: boolean;
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
): Promise<boolean> {
  try {
    const settingsRes = await fetch("/api/settings");
    const settingsData = await settingsRes.json();
    const toggle = settingsData.settings?.find((s: { key: string; value: string }) => s.key === "auto_discover_competitors");
    if (toggle?.value === "0") return false;

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
      return false;
    }

    const data = await res.json();
    const added: { url: string }[] = data.added ?? [];
    if (added.length === 0) {
      log(
        data.usedWebSearch
          ? "No confident competitors found yet — add some manually in the Context panel."
          : "No Tavily key connected, so I only had existing site data to go on — no confident competitors found. Add some manually, or connect Tavily in Settings for deeper discovery."
      );
      return false;
    }

    const names = added.map((a) => a.url.replace(/^https?:\/\//, "")).join(", ");
    log(
      `${data.usedWebSearch ? "Searched the web and found" : "Based on your site's own content, found"} ${added.length} real competitor${added.length === 1 ? "" : "s"}: ${names}.`
    );
    onAdded();
    return true;
  } catch {
    log("Couldn't reach the competitor discovery service — add competitors manually in the Context panel.");
    return false;
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

/** Runs right after a new project's crawl + competitor discovery finish —
 * generates every Context document a user would otherwise have to click
 * "Generate" for one by one (see ContextPanel.tsx's document panels). Same
 * grounding order the manual flow relies on: Product Info first, then
 * Marketing Strategy (reads Product Info), then the two competitor
 * documents (only if at least one competitor exists — both routes reject
 * otherwise, matching the manual "Add a competitor first" gate), then
 * Content Strategy (reads all three), then Design Guide (reads Marketing
 * Strategy). Each step is independent of the others failing — one document
 * erroring (e.g. a transient LLM timeout) shouldn't block the rest. */
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
  priorProblems: string[] = []
): Promise<void> {
  const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
  if (!primaryModel || !providerId) {
    log("Skipping auto-generated context documents — connect a model in Settings to enable it.");
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

  /** Runs one document unless a prerequisite failed (then it is skipped and
   * the reason is logged), records the outcome, and bumps documentsVersion on
   * a real save so the Context panel picks it up. */
  const step = async (
    key: DocKey,
    title: string,
    run: () => Promise<boolean>
  ): Promise<void> => {
    const blocker = blockedBy(key, outcomes);
    if (blocker) {
      log(`Skipping ${title} — ${blocker} didn't finish, and ${title} is written from it. Retry ${blocker} in the Context panel first.`);
      outcomes.push({ key, title, status: "blocked" });
      return;
    }
    const ok = await run();
    if (ok) onSaved();
    outcomes.push({ key, title, status: ok ? "ready" : "failed" });
  };
  const generate = (key: DocKey, title: string) =>
    step(key, title, () => generateAndSaveDocument(key, title, primaryModel, providerId, log));

  log("Writing your Context documents — Product Information, Marketing Strategy, Competitor Analysis, Competitor Comparison, Content Strategy, and Design Guide...");
  await generate("product-info", "Product Information");
  if (!(await guard())) return;
  await generate("marketing-strategy", "Marketing Strategy");
  if (!(await guard())) return;
  if (hasCompetitors) {
    await generate("competitor-analysis", "Competitor Analysis");
    if (!(await guard())) return;
    await step("competitor-comparison", "Competitor Comparison", () =>
      generateSelfSavingDocument("competitor-comparison", "Competitor Comparison", primaryModel, providerId, log)
    );
    if (!(await guard())) return;
  } else {
    log("Skipping Competitor Analysis and Competitor Comparison — no competitors found or added yet.");
    outcomes.push({ key: "competitor-analysis", title: "Competitor Analysis", status: "skipped" });
    outcomes.push({ key: "competitor-comparison", title: "Competitor Comparison", status: "skipped" });
  }
  await generate("content-strategy", "Content Strategy");
  if (!(await guard())) return;
  await generate("design-guide", "Design Guide");

  const summary = summarizeDocumentRun(outcomes);
  if (summary.hasProblems) log(`⚠ ${summary.text}`);
  else logDone(`Context documents: ${summary.text} Review and edit anytime in the Context panel.`);

  const problems = [...priorProblems];
  if (summary.hasProblems) problems.push(summary.text.replace(/: open Context to retry\.$/, ""));
  const last = finalSetupLine(problems);
  if (last.ok) logDone(last.text);
  else log(`⚠ ${last.text}`);
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
  const [competitorsVersion, setCompetitorsVersion] = useState(0);
  const [auditVersion, setAuditVersion] = useState(0);
  const [documentsVersion, setDocumentsVersion] = useState(0);
  const [leadsVersion, setLeadsVersion] = useState(0);
  /** Project whose setup run is in flight. See settleSetupRun / isSetupRunning. */
  const [setupRunningId, setSetupRunningId] = useState<string | null>(null);
  const { log, logDone } = useTerminalLog();
  const { primaryModel } = useProviders();

  const notifyAuditChanged = useCallback(() => setAuditVersion((v) => v + 1), []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/project");
      let data = await res.json();
      // Projects exist but none is active (pointer lost/cleared): activate the
      // newest instead of leaving the user with a dashboard that reports
      // "No active project" (and, formerly, the new-user onboarding modal).
      if (!data.project && Array.isArray(data.projects) && data.projects.length > 0) {
        const switched = await fetch("/api/project/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: data.projects[0].id }),
        }).catch(() => null);
        if (switched?.ok) data = await fetch("/api/project").then((r) => r.json());
      }
      setProject(data.project ?? null);
      setProjects(data.projects ?? []);
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
        setSetupRunningId(null);
      }
    });
    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [refresh]);

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
      setProject(data.project);
      setProjects((prev) => [data.project, ...prev.filter((p) => p.id !== data.project.id)]);
      setSetupRunningId(data.project.id);

      log("Starting my deep dive — crawling your pages for SEO, content, and growth signals.");

      // Everything required that did not work, in plain words. Drives the
      // final line: "Setup complete" only when this stays empty.
      const problems: string[] = [];
      let crawlSucceeded = false;
      try {
        const auditRes = await fetch("/api/agents/seo/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: data.project.url }),
        });

        if (auditRes.ok) {
          crawlSucceeded = true;
          setAuditVersion((v) => v + 1);
          const audit = await auditRes.json();
          log(
            audit.meta?.title
              ? `Found it: "${audit.meta.title}". Context, Analytics, and agents now have real data to work from.`
              : "Crawled the site. Context, Analytics, and agents now have real data to work from."
          );
        } else {
          const err = await auditRes.json().catch(() => ({}));
          log(`Couldn't fully crawl the site (${err.error ?? "unknown error"}) — agents will still use the URL directly.`);
          problems.push("the site crawl failed, so there is no audit yet");
        }
      } catch {
        log("Couldn't reach the crawl service — agents will still use the URL directly.");
        problems.push("the site crawl could not be reached, so there is no audit yet");
      }

      if (crawlSucceeded) {
        const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
        if (input.description?.trim()) {
          // The user wrote their own description: never overwrite it with a generated one.
        } else if (primaryModel && providerId) {
          try {
            log("Writing a real description from what's actually on the page...");
            const descRes = await fetch(`/api/project/${data.project.id}/generate-description`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: primaryModel, providerId }),
            });
            if (descRes.ok) {
              const { description } = await descRes.json();
              setProject((prev) => (prev && prev.id === data.project.id ? { ...prev, description } : prev));
              setProjects((prev) => prev.map((p) => (p.id === data.project.id ? { ...p, description } : p)));
              logDone(`Description: "${description}"`);
            } else {
              const err = await descRes.json().catch(() => ({}));
              log(`Couldn't write a description (${err.error ?? `HTTP ${descRes.status}`}) — generate it from Context, or edit it in Settings → Websites.`);
              problems.push("no description");
            }
          } catch {
            // non-fatal — description stays blank, editable manually in Settings → Websites
            log("Couldn't reach the description service — generate it from Context, or edit it in Settings → Websites.");
            problems.push("no description");
          }
        } else {
          problems.push("no description (connect a model in Settings)");
        }

        const hasCompetitors = await maybeDiscoverCompetitors(
          data.project.id,
          log,
          primaryModel,
          () => setCompetitorsVersion((v) => v + 1)
        );

        // Free, platform-only baseline (up to 10 leads) -- runs on the
        // platform's own Groq key, not whatever LLM the user has connected,
        // so it works even before they've set up LLM Providers at all.
        // Self-host has no equivalent; this never runs there.
        if (FEATURES.PLATFORM_MODE) {
          try {
            log("Finding real leads to kick off outreach...");
            const leadsRes = await fetch(`/api/project/${data.project.id}/generate-leads`, { method: "POST" });
            if (leadsRes.ok) {
              const { added, message } = await leadsRes.json();
              if (added > 0) {
                logDone(`Found ${added} real lead${added === 1 ? "" : "s"} — check the Leads panel.`);
                setLeadsVersion((v) => v + 1);
              } else {
                log(message ? `${message} Search manually in the Leads panel, or check back tomorrow.` : "No confident leads found yet — search manually in the Leads panel, or check back tomorrow.");
              }
            } else {
              log("Couldn't find leads automatically — search manually in the Leads panel.");
            }
          } catch {
            // non-fatal -- leads can always be found manually in the Leads panel
            log("Couldn't reach the lead finder — search manually in the Leads panel.");
          }
        }

        // Deliberately NOT awaited. Six documents generate sequentially and
        // each route allows up to 60s (maxDuration), so awaiting here can
        // hold OnboardingModal's spinner for minutes before the user ever
        // sees the dashboard — the modal only calls onDone() after
        // createProject resolves. The terminal log streams progress as each
        // document lands, and the Context panel fills in behind it.
        //
        // Errors are already handled per-document inside
        // autoGenerateContextDocuments (each logs and moves on), so the
        // catch here only covers an unexpected throw in the orchestration
        // itself — without it that would surface as an unhandled rejection.
        void autoGenerateContextDocuments(
          data.project.id,
          primaryModel,
          hasCompetitors,
          log,
          logDone,
          () => setDocumentsVersion((v) => v + 1),
          problems
        )
          .catch(() => {
            log("⚠ Setup finished with problems: couldn't finish writing your context documents. Open Context to finish setup.");
          })
          .finally(() => setSetupRunningId((cur) => settleSetupRun(cur, data.project.id)));
        // The final "Setup complete" / "Setup finished with problems" line is
        // written by autoGenerateContextDocuments once the documents settle:
        // saying "complete" here would be a claim about work still running.
        log("Core setup done — documents are being written in the background.");
        return;
      }

      // Documents will not run (crawl failed): nothing is still in flight, so
      // the outcome is known now.
      setSetupRunningId((cur) => settleSetupRun(cur, data.project.id));
      const last = finalSetupLine(problems);
      if (last.ok) logDone(last.text);
      else log(`⚠ ${last.text}`);
    },
    [log, logDone, primaryModel]
  );

  const switchProject = useCallback(
    async (id: string) => {
      const target = projects.find((p) => p.id === id);
      if (target) log(`Switching to ${target.name}...`);

      const res = await fetch("/api/project/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

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
      value={{ project, projects, loading, setupRunning: isSetupRunning(setupRunningId, project?.id), createProject, switchProject, updateProject, deleteProject, competitorsVersion, auditVersion, documentsVersion, leadsVersion, notifyAuditChanged }}
    >
      {children}
    </ProjectCtx.Provider>
  );
}
