"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";
import { FEATURES } from "@/lib/features";
import GitHubAppCard from "@/components/settings/GitHubAppCard";

/** Real GitHub PAT + repo, validated live against the GitHub API before
 * either is saved (same honesty pattern as every other credential card
 * here — never store something that doesn't actually work). Powers the
 * code-fix agent (SEO findings → real file read → LLM patch → real PR) and
 * the Integrations page's "publish to repo" slot — one real connection,
 * not two separate fake cards.
 *
 * Self-host: plaintext settings.github_pat/github_repo (resolveContext.ts
 * reads these directly). Platform mode: PAT through /api/providers
 * (provider_id "github", Vault-encrypted) same as any BYOK key; repo name
 * isn't a secret so it stays in user_settings.github_repo — this is exactly
 * what codefix/propose+apply already read, this card was the one place
 * still writing to the old insecure self-host-only path regardless of mode. */
export default function GitHubCodeFixCard() {
  const { show } = useToast();
  const [connected, setConnected] = useState(false);
  const [githubAuthorized, setGithubAuthorized] = useState(false);
  const [repoSaved, setRepoSaved] = useState("");
  const [patInput, setPatInput] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Hosted: use the GitHub App flow when this deployment has the App configured, else the legacy OAuth card below.
  const [appConfigured, setAppConfigured] = useState<boolean | null>(FEATURES.PLATFORM_MODE ? null : false);

  useEffect(() => {
    if (FEATURES.PLATFORM_MODE) {
      fetch("/api/github/app/status")
        .then((r) => r.json())
        .then((d: { configured?: boolean }) => setAppConfigured(Boolean(d.configured)))
        .catch(() => setAppConfigured(false));
    }
  }, []);

  useEffect(() => {
    if (FEATURES.PLATFORM_MODE) {
      Promise.all([fetch("/api/providers").then((r) => r.json()), fetch("/api/settings").then((r) => r.json())])
        .then(([providersData, settingsData]) => {
          const githubConn = providersData.connections?.find((c: { providerId: string }) => c.providerId === "github");
          const repoRow = settingsData.settings?.find((s: { key: string; value: string }) => s.key === "github_repo");
          if (githubConn) setGithubAuthorized(true);
          if (githubConn && repoRow?.value) {
            setConnected(true);
            setRepoSaved(repoRow.value);
          }
        })
        .catch(() => {})
        .finally(() => setLoaded(true));
      return;
    }

    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings: { key: string; value: string }[] }) => {
        const patRow = data.settings?.find((s) => s.key === "github_pat");
        const repoRow = data.settings?.find((s) => s.key === "github_repo");
        if (patRow?.value && repoRow?.value) {
          setConnected(true);
          setRepoSaved(repoRow.value);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function saveSetting(key: string, value: string) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save");
  }

  async function saveGithubProvider(pat: string) {
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "github", apiKey: pat }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save");
  }

  async function handleConnect() {
    if (FEATURES.PLATFORM_MODE) {
      if (!repoInput.trim()) {
        show("Enter the repository (owner/repo) you want Marlo to use.");
        return;
      }
      setBusy(true);
      try {
        const res = await fetch("/api/settings/github/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo: repoInput.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          show(data.error || "Couldn't verify repository access.");
          return;
        }
        await saveSetting("github_repo", data.fullName);
        setConnected(true);
        setRepoSaved(data.fullName);
        setRepoInput("");
        show(`Connected to ${data.fullName} — fixable SEO findings can now open real draft PRs.`);
      } catch (err) {
        show(err instanceof Error ? err.message : "Failed to connect repository.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!patInput.trim() || !repoInput.trim()) {
      show("Enter both a token and a repository (owner/repo).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/github/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: patInput.trim(), repo: repoInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(data.error || "Couldn't verify token/repo.");
        return;
      }
      if (FEATURES.PLATFORM_MODE) {
        await saveGithubProvider(patInput.trim());
      } else {
        await saveSetting("github_pat", patInput.trim());
      }
      await saveSetting("github_repo", data.fullName);
      setConnected(true);
      setRepoSaved(data.fullName);
      setPatInput("");
      setRepoInput("");
      show(`Connected to ${data.fullName} — fixable SEO findings can now open real PRs.`);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to connect GitHub.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      if (FEATURES.PLATFORM_MODE) {
        await fetch("/api/auth/github/disconnect", { method: "POST" });
        setGithubAuthorized(false);
      } else {
        await saveSetting("github_pat", "");
      }
      await saveSetting("github_repo", "");
      setConnected(false);
      setRepoSaved("");
      show("GitHub disconnected.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disconnect GitHub.");
    } finally {
      setBusy(false);
    }
  }

  if (FEATURES.PLATFORM_MODE && appConfigured === null) return <div className="h-24 animate-pulse rounded-xl bg-ui-surface-sunken" aria-busy="true" />;
  if (FEATURES.PLATFORM_MODE && appConfigured) return <GitHubAppCard />;

  if (FEATURES.PLATFORM_MODE) {
    return (
      <div className="rounded-xl border border-ui-border bg-ui-surface p-5 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <BrandIcon id="github" color="#111111" fallback="G" />
            <div>
              <div className="text-[13px] font-semibold text-ui-text">GitHub — Code Fix Agent</div>
              <div className="mt-1 text-[12px] text-ui-muted">Authorize GitHub with your account, then select the repository Marlo may use for draft SEO fixes. No personal access token is required.</div>
            </div>
          </div>
          <span className="rounded-full bg-ui-accent-soft px-2 py-0.5 text-xs font-medium text-ui-accent-strong">OAuth</span>
        </div>
        {!loaded ? null : !githubAuthorized ? (
          <a href="/api/auth/github/connect" className="inline-flex items-center justify-center rounded-lg bg-ui-primary min-h-11 px-3.5 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface font-medium text-ui-inverse hover:bg-ui-primary-hover">Connect GitHub</a>
        ) : connected ? (
          <div className="flex items-center justify-between rounded-lg bg-ui-surface-muted px-3 py-2 text-[12px] text-ui-muted">
            <span className="min-w-0 break-all font-mono">{repoSaved}</span>
            <button onClick={handleDisconnect} disabled={busy} className="font-medium text-ui-danger-text hover:underline disabled:opacity-50">Disconnect</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input value={repoInput} onChange={(e) => setRepoInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleConnect()} placeholder="owner/repository" className="min-w-0 flex-1 min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint" />
            <button onClick={handleConnect} disabled={busy} className="shrink-0 rounded-lg bg-ui-primary min-h-11 px-3.5 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface font-medium text-ui-inverse hover:bg-ui-primary-hover disabled:opacity-50">{busy ? "Verifying..." : "Use repository"}</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ui-border bg-ui-surface p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandIcon id="github" color="#111111" fallback="G" />
          <div>
            <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-ui-text">
              GitHub — Code Fix Agent
              {connected && (
                <span className="flex items-center gap-1 rounded-full bg-ui-success-soft px-2 py-0.5 text-xs font-medium text-ui-success-text">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-ui-muted">
              Lets fixable SEO findings (meta tags, canonical, OG/Twitter tags, robots.txt) open real draft
              PRs against your repo. Fine-grained token needs Contents + Pull requests read/write on this
              one repo — never request org-wide access.
            </div>
          </div>
        </div>
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-ui-subtle hover:text-ui-text"
        >
          Create token <ExternalLink size={11} />
        </a>
      </div>

      {!loaded ? null : connected ? (
        <div className="flex items-center justify-between rounded-lg bg-ui-surface-muted px-3 py-2 text-[12px] text-ui-muted">
          <span className="min-w-0 break-all font-mono">{repoSaved}</span>
          <button onClick={handleDisconnect} disabled={busy} className="font-medium text-ui-danger-text hover:underline disabled:opacity-50">
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={patInput}
            onChange={(e) => setPatInput(e.target.value)}
            placeholder="github_pat_..."
            type="password"
            className="min-w-0 w-full min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint"
          />
          <div className="flex gap-2">
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              placeholder="yourname/yourrepo"
              className="min-w-0 flex-1 min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint"
            />
            <button
              onClick={handleConnect}
              disabled={busy}
              className="shrink-0 rounded-lg bg-ui-primary min-h-11 px-3.5 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface font-medium text-ui-inverse hover:bg-ui-primary-hover disabled:opacity-50"
            >
              {busy ? "Verifying..." : "Connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
