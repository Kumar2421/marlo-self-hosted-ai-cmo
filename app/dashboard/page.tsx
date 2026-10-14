"use client";

import { useState, useEffect, Suspense } from "react";
import TerminalLog from "@/components/dashboard/TerminalLog";
import ContextPanel from "@/components/dashboard/ContextPanel";
import AnalyticsPanelBase from "@/components/dashboard/AnalyticsPanel";
import { useProject } from "@/lib/project-store";
import LeadsPanel from "@/components/dashboard/LeadsPanel";
// AgentsFeedPanel hidden (not deleted) — replaced by LeadsPanel in the same
// column slot. Re-import "@/components/dashboard/AgentsFeedPanel" to restore.
import ChatPanel from "@/components/dashboard/ChatPanel";
import MobileTabBar, { type MobileTab } from "@/components/dashboard/MobileTabBar";
import Loading from "../loading";
import { DashboardDataProvider, useDashboardData } from "@/lib/dashboard-data";
import OnboardingModal from "@/components/dashboard/OnboardingModal";
import { SocialPanelProvider } from "@/components/dashboard/social/SocialPanelProvider";

const RAIL = "56px";

/** Below this width the 4-column grid can't fit — panels get squeezed to
 * slivers instead of readable columns. Below it we switch to one
 * full-screen panel at a time, picked via MobileTabBar. Matches Tailwind's
 * `md` breakpoint so it lines up with the `md:` classes used elsewhere on
 * this page and inside each panel's collapse button. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isMobile;
}

/** First-time users with no project yet see the dashboard underneath (so
 * it's already loaded once the dialog closes) with a small onboarding
 * dialog on top — driven by the same /api/project/data fetch every panel
 * already needs, via the dashboard data provider this page already mounts.
 * Any other fetch failure (real 500, network) is left alone; only the
 * specific "no project" 404 shows the dialog. */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data, loading, error, refresh } = useDashboardData();
  const needsOnboarding = !loading && !data && error === "No active project";

  return (
    <>
      {children}
      {needsOnboarding && <OnboardingModal onDone={refresh} />}
    </>
  );
}

/** Keyed by project: switching projects remounts the panel, so every tab starts clean instead of showing the previous project's data. */
function AnalyticsPanel(props: React.ComponentProps<typeof AnalyticsPanelBase>) {
  const { project } = useProject();
  return <AnalyticsPanelBase key={project?.id ?? "none"} {...props} />;
}

export default function DashboardPage() {
  const [contextOpen, setContextOpen] = useState(true);
  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [mobileTab, setMobileTab] = useState<MobileTab>("context");
  const isMobile = useIsMobile();
  const { loading: projectLoading } = useProject();

  const cols = [
    contextOpen ? "22%" : RAIL,
    analyticsOpen ? "26%" : RAIL,
    agentsOpen ? "26%" : RAIL,
    chatOpen ? "1fr" : RAIL,
  ].join(" ");

  // Wait for the real signal (the project store has answered), not a fixed delay.
  if (projectLoading) return <Loading />;

  if (isMobile) {
    return (
      <DashboardDataProvider>
        <SocialPanelProvider>
        <OnboardingGate>
          <div className="flex h-dvh flex-col bg-white">
            <TerminalLog />
            <div className="min-h-0 flex-1 overflow-hidden">
              {mobileTab === "context" && <ContextPanel open onToggle={() => {}} />}
              {mobileTab === "analytics" && (
                <Suspense fallback={null}>
                  <AnalyticsPanel open onToggle={() => {}} />
                </Suspense>
              )}
              {mobileTab === "agents" && <LeadsPanel open onToggle={() => {}} />}
              {mobileTab === "chat" && <ChatPanel open onToggle={() => {}} />}
            </div>
            <MobileTabBar active={mobileTab} onChange={setMobileTab} />
          </div>
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
          <TerminalLog />
          <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: cols }}>
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
