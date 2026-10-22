"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import GhostLoader from "@/components/shared/GhostLoader";
import { useProject } from "@/lib/project-store";
import { useToast } from "@/components/dashboard/Toast";
import { deriveNameFromUrl } from "@/lib/domain/project/projectName";

const SOURCE_OPTIONS = [
  "Google Search",
  "X / Twitter",
  "Reddit",
  "A friend or colleague",
  "Blog or newsletter",
  "Other",
];

const ROLE_OPTIONS = ["Founder / Solo builder", "Marketer", "Developer", "Agency", "Other"];

function OkaraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill="#111111" />
      <circle cx="18.5" cy="9.5" r="7" fill="#ffffff" fillOpacity="0.95" />
      <circle cx="18.5" cy="9.5" r="3.2" fill="#111111" />
    </svg>
  );
}

async function saveSetting(key: string, value: string) {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  }).catch(() => {});
}

/** First-run onboarding, shown as a small dialog over the dashboard (not a
 * separate page) — matches okara.ai's "the website is the onboarding"
 * model: a couple of quick questions, then a URL that kicks off the same
 * real crawl flow as "+ New project" (see lib/project-store.tsx).
 * DashboardPage renders the real dashboard underneath so it's already
 * loaded the moment this closes, instead of a page navigation. */
export default function OnboardingModal({ onDone }: { onDone: () => void }) {
  const { show } = useToast();
  const { createProject } = useProject();
  const router = useRouter();

  const [source, setSource] = useState(SOURCE_OPTIONS[0]);
  const [role, setRole] = useState(ROLE_OPTIONS[0]);
  const [url, setUrl] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("marlo:pending-audit-url") ?? "" : "",
  );
  const [saving, setSaving] = useState(false);

  // The modal cannot be closed, so give the user a way out (for example, signed in with the wrong account).
  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  async function handleContinue() {
    if (saving) return;
    if (!url.trim()) {
      show("Enter your website URL to get started.");
      return;
    }
    setSaving(true);
    try {
      await Promise.all([
        saveSetting("onboarding_source", source),
        saveSetting("personalization_role", role),
      ]);
      await createProject({ name: deriveNameFromUrl(url.trim()), url: url.trim() });
      // Only after the project exists: a failed first attempt must not count as onboarded.
      await saveSetting("onboarding_completed", "true");
      localStorage.removeItem("marlo:pending-audit-url");
      onDone();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to set up your site.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-1 flex items-center gap-2">
          <OkaraMark className="h-5 w-5" />
          <span className="text-sm font-bold tracking-tight text-gray-900">Marlo</span>
        </div>
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-gray-900">Let&apos;s grow your business.</h2>
        <p className="mt-0.5 text-[12px] text-gray-500">Get started with your AI CMO.</p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-medium text-gray-700">How did you hear about us?</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-[13px] outline-none focus:border-gray-900"
            >
              {SOURCE_OPTIONS.map((opt) => (
                <option key={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-medium text-gray-700">What best describes you?</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-[13px] outline-none focus:border-gray-900"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-medium text-gray-700">Your website</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleContinue()}
              placeholder="yourproduct.com"
              className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-[13px] outline-none focus:border-gray-900"
            />
          </div>

          <button
            onClick={handleContinue}
            disabled={saving}
            className="mt-1 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#111111] text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {saving ? <GhostLoader className="h-4 w-4" tone="light" /> : null}
            {saving ? "Setting up your site..." : "Get started"}
            {!saving && <ArrowRight className="h-3.5 w-3.5" />}
          </button>
        </div>

        <p className="mt-3 text-xs leading-4 text-ui-subtle">
          We&apos;ll crawl your site for real SEO, content, and competitor data. You can rename or add more sites
          later in Settings → Websites.
        </p>

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-900 hover:underline"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
