"use client";

import { useState, Suspense } from "react";
import { visibleTabs, TABLET_LEFT, TABLET_RIGHT, DEFAULT_TABLET_RIGHT, type DashboardTab } from "@/lib/dashboardShell";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { useDashboardTab } from "@/lib/useDashboardTab";
import TerminalLog from "@/components/dashboard/TerminalLog";
import ContextPanel from "@/components/dashboard/ContextPanel";
import AnalyticsPanelBase from "@/components/dashboard/AnalyticsPanel";
import { useProject } from "@/lib/project-store";
import LeadsPanel from "@/components/dashboard/LeadsPanel";
// AgentsFeedPanel hidden (not deleted) — replaced by LeadsPanel in the same
// column slot. Re-import "@/components/dashboard/AgentsFeedPanel" to restore.
import ChatPanel from "@/components/dashboard/ChatPanel";
import MobileTabBar, { panelId, tabId } from "@/components/dashboard/MobileTabBar";
import Loading from "../loading";
import { DashboardDataProvider, useDashboardData } from "@/lib/dashboard-data";
import OnboardingModal from "@/components/dashboard/OnboardingModal";
import { needsOnboarding } from "@/lib/domain/project/onboardingGate";
import { SocialPanelProvider } from "@/components/dashboard/social/SocialPanelProvider";

const RAIL = "56px";

/** First-time users with no project yet see the dashboard underneath with a
 * small onboarding dialog on top. The decision comes from the project list
 * (already loaded before this renders), so the dialog appears in the same
 * paint as the dashboard shell instead of after /api/project/data fails.
 * A failed project-list request (500, network) never shows it. */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { refresh } = useDashboardData();
  const { projects, project, loading, projectsLoaded } = useProject();
  const showOnboarding = needsOnboarding({ projectsCount: projects.length, activeProjectId: project?.id, projectsLoaded, loading });

  return (
    <>
      {children}
      {showOnboarding && <OnboardingModal onDone={refresh} />}
    </>
  );
}

/** Keyed by project: switching projects remounts the panel, so every tab starts clean instead of showing the previous project's data. */
function AnalyticsPanel(props: React.ComponentProps<typeof AnalyticsPanelBase>) {
  const { project } = useProject();
  return <AnalyticsPanelBase key={project?.id ?? "none"} {...props} />;
}

/** Phone and tablet shell. Panels mount the first time their tab is opened and
 * then stay mounted (hidden + inert), so scroll, filters, chat drafts and
 * Leads data survive tab switches. Phones show one panel; tablets (768-1099px)
 * show two panes: Context|Analytics on the left, Leads|Chat on the right.
 * First screen: ?tab=, else the user's last tab, else Analytics when the
 * project has an audit (Context while setup is unfinished). On tablets the
 * right pane defaults to Chat, so the first pair is Analytics + Chat. */
function CompactShell({ bp }: { bp: "mobile" | "tablet" }) {
  const { data, loading } = useDashboardData();
  // null = not known yet (still loading). A failed load counts as "no audit": setup lives in Context.
  const hasAudit = data ? data.data.seo_audits.length > 0 : loading ? null : false;
  const [tab, setTab] = useDashboardTab(hasAudit);
  const [lastLeft, setLastLeft] = useState<DashboardTab>("analytics");
  const [lastRight, setLastRight] = useState<DashboardTab>(DEFAULT_TABLET_RIGHT);
  const [opened, setOpened] = useState<ReadonlySet<DashboardTab>>(() => new Set());

  // Undecided: keep the loading screen instead of flashing a panel and switching.
  if (tab === null) return <Loading />;

  const shown = visibleTabs(bp, tab, lastLeft, lastRight);

  // Remember each tablet pane's last choice (render-time adjustment, no effect).
  if (TABLET_LEFT.includes(tab) && tab !== lastLeft) setLastLeft(tab);
  if (TABLET_RIGHT.includes(tab) && tab !== lastRight) setLastRight(tab);
  // Mount a panel the first time it is shown, then keep it mounted.
  if (shown.some((t) => !opened.has(t))) setOpened(new Set([...opened, ...shown]));

  const noop = () => {};
  const render = (t: DashboardTab) => {
    if (!opened.has(t) && !shown.includes(t)) return null;
    switch (t) {
      case "context":
        return <ContextPanel open onToggle={noop} />;
      case "analytics":
        return (
          <Suspense fallback={null}>
            <AnalyticsPanel open onToggle={noop} />
          </Suspense>
        );
      case "agents":
        return <LeadsPanel open onToggle={noop} />;
      case "chat":
        return <ChatPanel open onToggle={noop} />;
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-white">
      <h1 className="sr-only">Marlo dashboard</h1>
      <TerminalLog />
      <main
        className={`grid min-h-0 flex-1 overflow-hidden ${bp === "tablet" ? "grid-cols-2" : "grid-cols-1"}`}
        style={{ gridTemplateRows: "minmax(0, 1fr)" }}
      >
        {(["context", "analytics", "agents", "chat"] as const).map((t) => {
          const visible = shown.includes(t);
          return (
            <section
              key={t}
              id={panelId(t)}
              role="tabpanel"
              aria-labelledby={tabId(t)}
              hidden={!visible}
              aria-hidden={!visible}
              inert={!visible}
              className="min-h-0 min-w-0 overflow-hidden border-gray-200 [&:not([hidden])~section:not([hidden])]:border-l"
              style={{ order: ["context", "analytics", "agents", "chat"].indexOf(t) }}
            >
              {render(t)}
            </section>
          );
        })}
      </main>
      <MobileTabBar active={tab} onChange={setTab} />
    </div>
  );
}

export default function DashboardPage() {
  const [contextOpen, setContextOpen] = useState(true);
  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const bp = useBreakpoint();
  const { loading: projectLoading } = useProject();

  const cols = [
    contextOpen ? "22%" : RAIL,
    analyticsOpen ? "26%" : RAIL,
    agentsOpen ? "26%" : RAIL,
    chatOpen ? "1fr" : RAIL,
  ].join(" ");

  // Wait for the real signal (the project store has answered), not a fixed delay.
  if (projectLoading) return <Loading />;

  if (bp !== "desktop") {
    return (
      <DashboardDataProvider>
        <SocialPanelProvider>
        <OnboardingGate>
          <CompactShell bp={bp} />
        </OnboardingGate>
        </SocialPanelProvider>
      </DashboardDataProvider>
    );
  }

  return (
    <DashboardDataProvider>
      <SocialPanelProvider>
      <OnboardingGate>
        <div className="flex h-dvh flex-col bg-white">
          <h1 className="sr-only">Marlo dashboard</h1>
          <TerminalLog />
          <div role="main" className="grid min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns: cols, gridTemplateRows: "minmax(0, 1fr)" }}>
            <ContextPanel open={contextOpen} onToggle={() => setContextOpen((v) => !v)} />
            <Suspense fallback={null}>
              <AnalyticsPanel open={analyticsOpen} onToggle={() => setAnalyticsOpen((v) => !v)} />
            </Suspense>
            <LeadsPanel open={agentsOpen} onToggle={() => setAgentsOpen((v) => !v)} />
            <ChatPanel open={chatOpen} onToggle={() => setChatOpen((v) => !v)} />
          </div>
        </div>
      </OnboardingGate>
      </SocialPanelProvider>
    </DashboardDataProvider>
  );
}
