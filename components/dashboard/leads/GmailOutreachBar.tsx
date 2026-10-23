"use client";

import { useState } from "react";
import { AlertTriangle, Check, Mail } from "lucide-react";
import { FEATURES } from "@/lib/features";
import { googleOAuthQueryParams, scopesFor } from "@/lib/googleOAuthScopes";
import { createClient } from "@/utils/supabase/client";
import { useGmailStatus } from "./useGmailStatus";

/**
 * Where the user connects Gmail for outreach, right in the Leads panel.
 *
 * Hosted users sign in with Google again, asking for permission to send the
 * emails they write and to read replies on those threads (one consent screen;
 * the sign-in callback stores the token). Self-hosters use the existing OAuth
 * flow with their own client. Google lets people untick individual
 * permissions, so a connection that cannot send or read is called out
 * instead of failing later.
 */
export default function GmailOutreachBar() {
  const gmail = useGmailStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connectHosted() {
    setBusy(true);
    setError(null);
    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
        scopes: scopesFor("gmail"),
        queryParams: googleOAuthQueryParams("gmail"),
      },
    });
    if (oauthError) {
      setBusy(false);
      setError(oauthError.message);
    }
  }

  const button = (label: string, tone: "primary" | "plain" = "primary") => {
    const className =
      tone === "primary"
        ? "ml-auto shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
        : "shrink-0 text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline disabled:opacity-50";
    return FEATURES.PLATFORM_MODE ? (
      <button type="button" onClick={connectHosted} disabled={busy} className={className}>
        {busy ? "Opening Google…" : label}
      </button>
    ) : (
      <a href="/api/auth/gmail/connect" className={className}>
        {label}
      </a>
    );
  };

  if (gmail.isLoading) {
    return <div className="mx-3 my-2 h-5 animate-pulse rounded bg-gray-100" aria-hidden="true" />;
  }

  if (gmail.isError) {
    return <div className="mx-4 my-3 text-xs text-amber-600">⚠ Couldn&apos;t check your Gmail connection.</div>;
  }

  if (!gmail.connected) {
    return (
      <div className="mx-4 my-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <Mail size={16} className="mt-0.5 shrink-0 text-ui-faint" />
          <div className="min-w-0 flex-[1_1_9rem]">
            <div className="text-[13px] font-semibold text-gray-900">Connect Gmail to email your leads</div>
            <p className="mt-0.5 text-xs leading-4 text-gray-500">
              Send outreach from your own address and see replies here. Marlo only reads replies on threads it started. On Google&apos;s
              screen, keep both Gmail boxes ticked.
            </p>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
          {button("Connect Gmail")}
        </div>
      </div>
    );
  }

  if (!gmail.canSend || !gmail.canRead) {
    const missing = !gmail.canSend && !gmail.canRead ? "send emails or read replies" : !gmail.canSend ? "send emails" : "read replies";
    return (
      <div className="mx-4 my-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-[1_1_9rem]">
            <div className="text-[13px] font-semibold text-amber-900">Gmail is connected, but can&apos;t {missing}</div>
            <p className="mt-0.5 text-xs leading-4 text-amber-800">
              {gmail.email ? `${gmail.email} ` : "This account "}
              was connected without a Gmail permission. Reconnect and keep every Gmail box ticked on Google&apos;s screen.
            </p>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
          {button("Reconnect Gmail")}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-3 flex min-h-9 items-center gap-1.5 text-xs text-gray-500" data-testid="gmail-status-bar">
      <Check size={12} className="shrink-0 text-emerald-600" />
      <span className="min-w-0 truncate">Sending as {gmail.email ?? "your Gmail"}</span>
      <span className="shrink-0 text-gray-300">·</span>
      {button("Reconnect", "plain")}
    </div>
  );
}
