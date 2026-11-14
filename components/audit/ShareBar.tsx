"use client";

import { useEffect, useState } from "react";
import { trackAuditEvent } from "./trackAuditEvent";

const TOKEN_KEY = (id: string) => `marlo:audit-owner:${id}`;

export function rememberOwnerToken(id: string, token: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY(id), token);
  } catch {
    /* private mode: the report still works, the owner just cannot remove it from here */
  }
}

function readOwnerToken(id: string): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY(id));
  } catch {
    return null;
  }
}

/** Copy link, share, and (only in the browser that ran the audit) remove. */
export default function ShareBar({ id, path, host }: { id: string; path: string; host: string }) {
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(readOwnerToken(id));
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, [id]);

  const fullUrl = () => `${window.location.origin}${path}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl());
      setCopied(true);
      trackAuditEvent({ event: "report_shared" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the address bar link instead.");
    }
  }

  async function share() {
    try {
      await navigator.share({ title: `${host} website audit`, url: fullUrl() });
      trackAuditEvent({ event: "report_shared" });
    } catch {
      /* the person closed the share sheet */
    }
  }

  async function remove() {
    if (!token) return;
    setError("");
    try {
      const res = await fetch(`/api/public/audit/report/${id}`, { method: "DELETE", headers: { "x-report-token": token } });
      if (!res.ok) throw new Error();
      try { window.localStorage.removeItem(TOKEN_KEY(id)); } catch { /* ignore */ }
      setRemoved(true);
    } catch {
      setError("Could not remove the report. Try again.");
    }
  }

  if (removed) {
    return <p role="status" className="text-sm text-black/60">This report was removed. The link no longer works.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="share-bar">
      <button type="button" onClick={copy} className="h-9 rounded-lg bg-[#111111] px-4 text-sm font-medium text-white">
        {copied ? "Link copied" : "Copy link"}
      </button>
      {canShare && (
        <button type="button" onClick={share} className="h-9 rounded-lg border border-black/15 bg-white px-4 text-sm font-medium">
          Share
        </button>
      )}
      {token && (
        <button type="button" onClick={remove} className="h-9 rounded-lg px-3 text-sm text-black/55 hover:text-black">
          Remove this report
        </button>
      )}
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
    </div>
  );
}
