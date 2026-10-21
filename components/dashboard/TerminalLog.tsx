"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import {
  ChevronDown,
  ChevronUp,
  Check,
  Plug,
  Settings,
  Globe,
  Gift,
  FileText,
  LogOut,
  Moon,
  Loader2,
  X,
  ScrollText,
} from "lucide-react";
import { user as mockUser } from "@/lib/mock-data";
import { useTerminalLog } from "@/lib/terminal-log-store";
import { useProject } from "@/lib/project-store";
import { useAuthUser } from "@/lib/useAuthUser";
import { useToast } from "./Toast";
import NotificationBell from "./notifications/NotificationBell";
import SocialNavMenu from "./social/SocialNavMenu";
import { useClickOutside } from "./useClickOutside";

function useCredits() {
  const [balance, setBalance] = useState<number | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/credits")
      .then((r) => r.json())
      .then((data) => {
        setBalance(typeof data.balance === "number" ? data.balance : null);
        setBillingEnabled(!!data.billingEnabled);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return { balance, billingEnabled, loaded };
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const router = useRouter();
  const { show } = useToast();
  const { user: authUser } = useAuthUser();
  const credits = useCredits();

  // Falls back to mock data until Supabase credentials are wired — keeps the
  // dashboard usable in local/self-host dev before a project exists.
  const user = authUser ?? mockUser;

  // null balance = self-host (no metering at all, bring-your-own-key model)
  // — hide the credits pill entirely rather than show a meaningless number.
  // Platform mode always has a real balance; while billing isn't enabled yet
  // (beta), every action is still metered for real behind the scenes (see
  // spend_credits()), just never blocks — so show that honestly instead of
  // a number that means nothing yet.
  const creditsLabel =
    credits.balance === null ? null : credits.billingEnabled ? `${credits.balance} Credits` : "Unlimited (beta)";

  async function handleLogout() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const items = [
    { icon: <Plug size={14} />, label: "Integrations", href: "/settings/integrations" },
    { icon: <Settings size={14} />, label: "Settings", href: "/settings" },
    { icon: <Globe size={14} />, label: "Language", href: "/settings/personalization" },
    { icon: <Gift size={14} />, label: "Invite Friends & Earn Money", href: null },
  ];

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2">
        <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-[#8a8a8a] text-[11px] font-semibold text-white">
          {user.initials}
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-[#110f0e] bg-[#00ab92]" />
        </div>
        <div className="hidden leading-tight text-left md:block">
          <div className="flex items-center gap-1 text-[13px] font-medium text-white">
            {user.name}
            <ChevronDown size={12} className={`opacity-50 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
          {creditsLabel && <div className="text-[11px] text-gray-400">{creditsLabel}</div>}
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-72 rounded-xl border border-gray-200 bg-white p-3 text-gray-900 shadow-xl">
          <div className="mb-2 flex items-center gap-3 rounded-lg p-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#8a8a8a] text-[12px] font-semibold text-white">
              {user.initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{user.name}</div>
              <div className="truncate text-[11px] text-gray-500">{user.email}</div>
            </div>
            <Moon size={15} className="shrink-0 text-gray-400" />
          </div>
          {creditsLabel && (
            <div className="mb-2 flex items-center gap-2 px-2">
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-700">
                {creditsLabel}
              </span>
              {credits.billingEnabled && (
                <button className="rounded-full bg-[#111111] px-3 py-1 text-[11px] font-medium text-white hover:bg-black">
                  Upgrade
                </button>
              )}
            </div>
          )}
          <div className="border-t border-gray-100 pt-2">
            {items.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  setOpen(false);
                  if (item.href) router.push(item.href);
                  else show(`${item.label} — coming soon.`);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50"
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 pt-2">
            <button
              onClick={() => {
                setOpen(false);
                show("Docs — coming soon.");
              }}
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
            >
              <FileText size={14} />
              Docs
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-red-600 hover:bg-red-50"
            >
              <LogOut size={14} />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const { createProject } = useProject();
  const { show } = useToast();

  async function handleCreate() {
    if (!name.trim() || !url.trim()) {
      show("Enter a project name and website URL.");
      return;
    }
    setSaving(true);
    try {
      await createProject({ name: name.trim(), url: url.trim(), category: category.trim() });
      show("Project created. Context, Analytics, and agents now use this site.");
      onClose();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900">New Project</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <label className="mb-1.5 block text-[12px] font-medium text-gray-700">Project name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. mlforge Invoice"
          className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-black"
        />

        <label className="mb-1.5 block text-[12px] font-medium text-gray-700">Website URL</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="yourproduct.com"
          className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-black"
        />

        <label className="mb-1.5 block text-[12px] font-medium text-gray-700">Category (optional)</label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="SaaS"
          className="mb-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-black"
        />

        <p className="mb-4 text-[11px] text-gray-400">
          After creating, the site gets crawled automatically and every agent + the
          Context/Analytics panels start using it. Watch the terminal log at the top for progress.
        </p>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {saving ? "Creating..." : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useClickOutside(() => setOpen(false));
  const { project, projects, loading, switchProject } = useProject();
  const { show } = useToast();

  const label = loading ? "Loading..." : project ? project.name : "No project yet";

  async function handleSwitch(id: string) {
    if (id === project?.id) {
      setOpen(false);
      return;
    }
    setSwitching(id);
    try {
      await switchProject(id);
      setOpen(false);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to switch project.");
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-white/15 px-2.5 py-1.5 text-white hover:bg-white/5"
      >
        <ChevronUp size={13} className="opacity-50" />
        <span className="h-4 w-4 shrink-0 rounded-full bg-indigo-400" />
        <span className="max-w-[100px] truncate text-[13px] font-medium md:max-w-none">{label}</span>
        <ChevronDown size={13} className={`opacity-50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-50 w-64 rounded-xl border border-gray-200 bg-white p-2 text-gray-900 shadow-xl">
          {projects.length === 0 ? (
            <div className="px-2.5 py-2 text-[12px] text-gray-400">No projects yet</div>
          ) : (
            <div className="max-h-64 overflow-y-auto okara-scroll">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSwitch(p.id)}
                  disabled={switching !== null}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] disabled:opacity-50 ${
                    p.id === project?.id ? "bg-gray-50 font-medium" : "hover:bg-gray-50"
                  }`}
                >
                  <span className="h-4 w-4 shrink-0 rounded-full bg-indigo-400" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {switching === p.id && <Loader2 size={12} className="shrink-0 animate-spin text-gray-400" />}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              setOpen(false);
              setModalOpen(true);
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-gray-100 px-2.5 py-2 pt-3 text-left text-[13px] text-gray-500 hover:bg-gray-50"
          >
            + New project
          </button>
        </div>
      )}
      {modalOpen && <NewProjectModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}

export default function TerminalLog() {
  // The terminal body is a drop-down overlay opened on demand, never auto-opened
  // and never in the layout flow: the bar stays one compact row and the 4-panel
  // grid below keeps its full height whether the log is open or not.
  const [logOpen, setLogOpen] = useState(false);
  const { lines } = useTerminalLog();
  const scrollRef = useRef<HTMLDivElement>(null);
  const ref = useClickOutside(() => setLogOpen(false));

  useEffect(() => {
    if (!logOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setLogOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [logOpen]);

  useEffect(() => {
    if (!logOpen) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, logOpen]);

  const latest = [...lines].reverse().find((l) => l.type !== "divider");

  return (
    <div ref={ref} className="relative z-30 shrink-0 bg-white px-3 pb-1 pt-2">
      <div data-testid="terminal-bar" className="flex h-12 shrink-0 items-center justify-between rounded-xl bg-[#110f0e] px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <DotLottieReact src="/ghost-loader.lottie" autoplay loop className="mr-1 h-7 w-7 shrink-0" />
          <ProjectSwitcher />

          <button
            onClick={() => setLogOpen((v) => !v)}
            aria-expanded={logOpen}
            aria-controls="terminal-log-panel"
            title={logOpen ? "Hide agent activity" : "Show agent activity"}
            className="ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-md border-l border-white/10 py-1 pl-3 pr-1 text-left text-[13px] hover:bg-white/5"
          >
            <span className="hidden shrink-0 items-center gap-1.5 text-gray-400 md:flex">
              <ScrollText size={13} />
              Status Log
            </span>
            <span className="hidden shrink-0 text-gray-600 md:inline">|</span>
            {latest ? (
              <span className={`min-w-0 flex-1 truncate ${latest.type === "done" ? "text-[#00ab92]" : "text-gray-300"}`}>
                {latest.type === "done" && <Check size={12} className="mr-1 inline shrink-0 align-[-1px]" />}
                {latest.text}
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-gray-500">No activity yet.</span>
            )}
            <ChevronDown size={13} className={`shrink-0 text-gray-400 transition-transform ${logOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-2">
          <SocialNavMenu />
          <NotificationBell />
          <UserMenu />
        </div>
      </div>

      {logOpen && (
        <div
          id="terminal-log-panel"
          role="log"
          aria-label="Agent activity"
          ref={scrollRef}
          className="okara-scroll-dark absolute inset-x-3 top-full z-40 max-h-[185px] overflow-y-auto rounded-xl border border-white/10 bg-[#110f0e] px-4 py-2.5 font-mono text-[12px] leading-[1.65] shadow-xl"
        >
          {lines.length === 0 && <div className="text-gray-600">Agent activity will show up here as it happens.</div>}
          {lines.map((line, i) => {
            if (line.type === "muted-link") {
              return (
                <div key={i} className="cursor-pointer text-gray-500 hover:text-gray-300">
                  <span className="mr-2 text-gray-600">{">"}</span>
                  {line.text}
                </div>
              );
            }
            if (line.type === "divider") {
              return (
                <div key={i} className="flex items-center gap-2 py-0.5 text-gray-600">
                  <span className="h-px w-6 bg-gray-700" />
                  {line.text}
                  <span className="h-px w-6 bg-gray-700" />
                </div>
              );
            }
            if (line.type === "done") {
              return (
                <div key={i} className="flex items-center gap-1.5 text-[#00ab92]">
                  <Check size={13} />
                  {line.text}
                </div>
              );
            }
            return (
              <div key={i} className="text-gray-100">
                <span className="mr-2 text-gray-600">{">"}</span>
                {line.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
