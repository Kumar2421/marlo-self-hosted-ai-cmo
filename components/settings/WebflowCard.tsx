"use client";

import { useEffect, useState } from "react";
import { Lock, Check, Loader2, ExternalLink } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/dashboard/Toast";
import { qk } from "@/lib/query/keys";

type Option = { id: string; name: string };

/** Real Webflow connection with a site API token, verified live against the Data API before
 * saving (see /api/settings/webflow/validate). Steps: paste the token (the sites it can see are
 * listed), pick the site, pick the CMS collection whose items Marlo may update. The token goes to
 * the same secret store as the other integrations; this card never keeps it after connecting.
 * Marlo only edits SEO fields (titles, descriptions, alt text) and only after you approve a
 * preview. Disconnect is immediate. */
export default function WebflowCard() {
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [summary, setSummary] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [sites, setSites] = useState<Option[] | null>(null);
  const [siteId, setSiteId] = useState("");
  const [collections, setCollections] = useState<Option[] | null>(null);
  const [collectionId, setCollectionId] = useState("");

  useEffect(() => {
    fetch("/api/settings/webflow/status")
      .then((r) => r.json())
      .then((data: { connected?: boolean; siteName?: string; collectionName?: string }) => {
        if (data.connected) {
          setConnected(true);
          setSummary(`${data.siteName ?? "Webflow site"} / ${data.collectionName ?? "collection"}`);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || "Request failed.");
    return data as T;
  }

  async function handleVerify() {
    if (!token.trim()) {
      show("Enter your Webflow site API token.");
      return;
    }
    setBusy(true);
    try {
      const data = await post<{ sites: Option[] }>("/api/settings/webflow/validate", { token: token.trim() });
      setSites(data.sites);
      setCollections(null);
      setCollectionId("");
      setSiteId(data.sites.length === 1 ? data.sites[0].id : "");
      if (data.sites.length === 1) await loadCollections(data.sites[0].id);
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't verify the Webflow token.");
    } finally {
      setBusy(false);
    }
  }

  async function loadCollections(id: string) {
    setSiteId(id);
    setCollections(null);
    setCollectionId("");
    if (!id) return;
    setBusy(true);
    try {
      const data = await post<{ collections: Option[] }>("/api/settings/webflow/validate", { token: token.trim(), siteId: id });
      setCollections(data.collections);
      if (data.collections.length === 1) setCollectionId(data.collections[0].id);
      if (data.collections.length === 0) show("This site has no CMS collections.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't load the site's collections.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect() {
    if (!siteId || !collectionId) {
      show("Choose a site and a collection.");
      return;
    }
    setBusy(true);
    try {
      const data = await post<{ siteName: string; collectionName: string }>("/api/settings/webflow/connect", { token: token.trim(), siteId, collectionId });
      setConnected(true);
      setSummary(`${data.siteName} / ${data.collectionName}`);
      setToken("");
      setSites(null);
      setCollections(null);
      setSiteId("");
      setCollectionId("");
      queryClient.invalidateQueries({ queryKey: qk.cmsStatus() });
      show(`Connected to ${data.siteName}.`);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to connect Webflow.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/webflow/disconnect", { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to disconnect Webflow.");
      setConnected(false);
      setSummary("");
      queryClient.invalidateQueries({ queryKey: qk.cmsStatus() });
      show("Webflow disconnected.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disconnect Webflow.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4353ff] text-[13px] font-bold text-white">W</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate text-[13px] font-semibold text-gray-900">
            Webflow
            {connected && (
              <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-xs font-medium text-ui-accent-strong">
                <Check size={10} /> Connected
              </span>
            )}
          </div>
          <div className="truncate text-[12px] text-gray-500">Apply SEO fixes to a CMS collection</div>
        </div>
        <a
          href="https://developers.webflow.com/data/docs/getting-started-data-clients#site-token"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-ui-subtle hover:text-gray-700"
        >
          Get a site token <ExternalLink size={11} />
        </a>
      </div>

      {!loaded ? null : connected ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          <span className="truncate">{summary}</span>
          <button onClick={handleDisconnect} disabled={busy} className="shrink-0 font-medium text-red-600 hover:underline disabled:opacity-50">
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setSites(null);
              setCollections(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && !sites && handleVerify()}
            placeholder="Site API token"
            type="password"
            autoComplete="off"
            className={input}
          />
          {!sites ? (
            <button
              onClick={handleVerify}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Lock size={11} />}
              {busy ? "Verifying..." : "Verify token"}
            </button>
          ) : (
            <>
              <select value={siteId} onChange={(e) => loadCollections(e.target.value)} disabled={busy} className={input}>
                <option value="">Choose a site</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {collections && (
                <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} disabled={busy} className={input}>
                  <option value="">Choose the collection to update</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
              <p className="text-xs leading-4 text-gray-500">
                The token needs CMS read and write. Marlo only edits SEO fields (titles, descriptions, image alt text) in this collection, and only after you approve a preview.
              </p>
              <button
                onClick={handleConnect}
                disabled={busy || !siteId || !collectionId}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Lock size={11} />}
                {busy ? "Connecting..." : "Connect"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
