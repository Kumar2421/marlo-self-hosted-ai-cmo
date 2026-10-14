"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";
import { useGithubStatus, useSaveGithubRepo } from "@/components/dashboard/findings/useCodeFix";
import { friendlyGithubError } from "@/lib/domain/github/friendlyGithubError";
import { safeReturnPath } from "@/lib/domain/github/returnPath";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";

/**
 * Hosted GitHub connection: install the Marlo GitHub App on chosen repositories, pick the one repo
 * this project's fixes go to, and disconnect. Marlo keeps only the installation and repo name.
 */
export default function GitHubAppCard() {
  const { show } = useToast();
  const { project } = useProject();
  const queryClient = useQueryClient();
  const status = useGithubStatus(true, true);
  const save = useSaveGithubRepo();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  // Where to send the user back to (their finding), when they arrived from one.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const gh = status.data;

  // GitHub sends people back here with ?github=connected or ?github_error=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("github_error");
    const connected = params.get("github") === "connected";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReturnTo(safeReturnPath(params.get("returnTo")));
    if (error) show(`GitHub: ${friendlyGithubError(error).message}`);
    else if (connected) show("GitHub connected. Choose the repository for this project.");
    if (error || connected) {
      params.delete("github_error");
      params.delete("github");
      const query = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
    }
  }, [show]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.githubStatus(project?.id) });

  async function saveRepo() {
    if (!choice) return;
    try {
      await save.mutateAsync(choice);
      show(`Marlo will open pull requests on ${choice}.`);
      setChoice("");
      setSaved(true);
    } catch (err) {
      show(`GitHub: ${friendlyGithubError(err instanceof Error ? err.message : null).message}`);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetchJson("/api/github/app/disconnect", { method: "POST" });
      await refresh();
      setSaved(false);
      show("GitHub disconnected from this project. To remove the Marlo app from your GitHub account, uninstall it in GitHub settings. Pull requests already opened stay open.");
    } catch (err) {
      show(`GitHub: ${friendlyGithubError(err instanceof Error ? err.message : null).message}`);
    } finally {
      setBusy(false);
    }
  }

  const installed = Boolean(gh?.connected || gh?.needsRepo);
  const connectHref = `/api/github/app/install?returnTo=${encodeURIComponent(returnTo ?? "/settings/integrations")}`;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <BrandIcon id="github" color="#111111" fallback="G" />
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
              GitHub
              {gh?.connected && (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="mt-1 text-[12px] text-gray-500">
              Marlo sends suggested changes for one repository per project as a pull request. You review and merge it on GitHub. Marlo never merges.
            </div>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">GitHub App</span>
      </div>

      {status.isPending ? (
        <div className="h-9 animate-pulse rounded-lg bg-gray-100" aria-busy="true" />
      ) : status.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          <span>We couldn&apos;t check GitHub.</span>
          <button type="button" onClick={() => status.refetch()} disabled={status.isFetching} className="font-medium text-blue-600 hover:underline disabled:opacity-50">
            {status.isFetching ? "Checking..." : "Retry"}
          </button>
        </div>
      ) : !installed ? (
        <div className="space-y-2">
          {gh?.error === "access_removed" && <p className="text-[12px] text-amber-700">Marlo lost access to GitHub. Connect it again to keep suggesting fixes.</p>}
          <a href={connectHref} className="inline-flex rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black">
            Connect GitHub
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          {gh?.error === "repos_unavailable" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <span>We couldn&apos;t check GitHub for the repository list.</span>
              <button type="button" onClick={() => status.refetch()} disabled={status.isFetching} className="font-medium underline disabled:opacity-50">
                {status.isFetching ? "Checking..." : "Retry"}
              </button>
            </div>
          )}
          {gh?.connected && (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
              <span className="font-mono">{gh.repoFullName}</span>
              <button onClick={disconnect} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-50">Disconnect</button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              aria-label="Repository"
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800"
            >
              <option value="">{gh?.connected ? "Switch repository..." : "Choose a repository..."}</option>
              {(gh?.repos ?? []).map((r) => (
                <option key={r.fullName} value={r.fullName}>{r.fullName}{r.private ? " (private)" : ""}</option>
              ))}
            </select>
            <button onClick={saveRepo} disabled={save.isPending || !choice} className="shrink-0 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50">
              {save.isPending ? "Saving..." : "Save repository"}
            </button>
          </div>
          {returnTo && saved && (
            <a href={returnTo} className="inline-block text-[12px] font-medium text-[#00846f] hover:underline">
              Back to your finding
            </a>
          )}
          {gh && !gh.connected && (
            <button onClick={disconnect} disabled={busy} className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-50">Disconnect</button>
          )}
          <p className="text-[11px] text-gray-400">
            Disconnecting only removes the link inside Marlo. To remove the app from your GitHub account, uninstall it in{" "}
            <a href="https://github.com/settings/installations" target="_blank" rel="noreferrer" className="underline">
              GitHub settings
            </a>
            .
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
            {gh?.slug ? (
              <span>
                Missing a repository?{" "}
                <a href={`https://github.com/apps/${gh.slug}/installations/new`} target="_blank" rel="noreferrer" className="underline">
                  Add it in GitHub
                </a>
                , then
              </span>
            ) : (
              <span>Missing a repository? Add it in GitHub, then</span>
            )}
            <button type="button" onClick={() => status.refetch()} disabled={status.isFetching} className="inline-flex items-center gap-1 font-medium text-[#00846f] hover:underline disabled:opacity-50">
              {status.isFetching && <Loader2 size={11} className="animate-spin" />}
              I&apos;ve added it, refresh list
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
