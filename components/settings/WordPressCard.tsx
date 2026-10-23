"use client";

import { useEffect, useState } from "react";
import { Lock, Check, Loader2, ExternalLink } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/dashboard/Toast";
import { qk } from "@/lib/query/keys";

/** Real WordPress (self-hosted) connection via Application Passwords (core
 * since WP 5.6) — no OAuth, no expiry, verified live against the site's own
 * REST API before saving (see /api/settings/wordpress/validate). Stored
 * through the same Vault-backed provider_connections slot as every other
 * BYOK key (provider_id "wordpress"): base_url holds the site origin, the
 * secret holds "username:app_password" combined (the shape Basic Auth
 * needs at request time) — connection storage only, actual article
 * publishing is a separate follow-up. */
export default function WordPressCard() {
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [siteSaved, setSiteSaved] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((data: { connections: { providerId: string; baseUrl?: string }[] }) => {
        const conn = data.connections?.find((c) => c.providerId === "wordpress");
        if (conn) {
          setConnected(true);
          setSiteSaved(conn.baseUrl ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function handleConnect() {
    if (!siteUrl.trim() || !username.trim() || !appPassword.trim()) {
      show("Enter your site URL, username, and application password.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/wordpress/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl: siteUrl.trim(), username: username.trim(), appPassword: appPassword.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(data.error || "Couldn't verify WordPress credentials.");
        return;
      }
      const saveRes = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "wordpress",
          apiKey: `${username.trim()}:${appPassword.trim()}`,
          baseUrl: data.siteUrl,
        }),
      });
      if (!saveRes.ok) throw new Error((await saveRes.json().catch(() => ({})))?.error ?? "Failed to save");
      setConnected(true);
      queryClient.invalidateQueries({ queryKey: qk.cmsStatus() });
      setSiteSaved(data.siteUrl);
      setSiteUrl("");
      setUsername("");
      setAppPassword("");
      show(`Connected to ${data.siteUrl}.`);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to connect WordPress.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await fetch("/api/providers?providerId=wordpress", { method: "DELETE" });
      setConnected(false);
      queryClient.invalidateQueries({ queryKey: qk.cmsStatus() });
      setSiteSaved("");
      show("WordPress disconnected.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disconnect WordPress.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-ui-border bg-ui-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#21759b] text-[13px] font-bold text-white">
          W
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-ui-text">
            WordPress (Self-Hosted)
            {connected && (
              <span className="flex items-center gap-1 rounded-full bg-ui-success-soft px-2 py-0.5 text-xs font-medium text-ui-success-text">
                <Check size={10} /> Connected
              </span>
            )}
          </div>
          <div className="text-[12px] text-ui-muted">Connect via Application Password</div>
        </div>
        <a
          href="https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-ui-subtle hover:text-ui-text"
        >
          How to create one <ExternalLink size={11} />
        </a>
      </div>

      {!loaded ? null : connected ? (
        <div className="mt-auto flex items-center justify-between rounded-lg bg-ui-surface-muted px-3 py-2 text-[12px] text-ui-muted">
          <span className="min-w-0 truncate font-mono">{siteSaved}</span>
          <button onClick={handleDisconnect} disabled={busy} className="shrink-0 font-medium text-ui-danger-text hover:underline disabled:opacity-50">
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-auto space-y-2">
          <input
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="yoursite.com"
            className="min-w-0 w-full min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint"
          />
          <div className="flex gap-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="WordPress username"
              className="min-w-0 flex-1 min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint"
            />
            <input
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              placeholder="Application password"
              type="password"
              className="min-w-0 flex-1 min-h-11 rounded-lg border border-ui-border-strong bg-ui-surface px-3 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 text-ui-text placeholder:text-ui-faint"
            />
          </div>
          <button
            onClick={handleConnect}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-ui-primary min-h-11 px-3.5 py-2 text-[13px] sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-text/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-surface font-medium text-ui-inverse hover:bg-ui-primary-hover disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Lock size={11} />}
            {busy ? "Verifying..." : "Connect"}
          </button>
        </div>
      )}
    </div>
  );
}
