"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readOwnerToken } from "./ShareBar";
import { trackAuditEvent } from "./trackAuditEvent";
import type { SamplePosts } from "@/lib/domain/seo/publicReportShared";
import { xWeightedLength } from "@/lib/domain/social/xLength";
import { linkedinFold } from "@/lib/domain/social/previewFold";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* clipboard blocked: the text is on screen to select */
        }
      }}
      className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-medium"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function XCard({ text, name }: { text: string; name: string }) {
  const count = xWeightedLength(text);
  return (
    <div className="rounded-lg border border-black/10 p-4" data-testid="sample-x">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-black/40">X post</p>
        <CopyButton text={text} label="Copy X post" />
      </div>
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111111] text-sm font-semibold text-white" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-black/80">{text}</p>
        </div>
      </div>
      <p className="mt-3 text-right text-xs tabular-nums text-black/40">{count}/280</p>
    </div>
  );
}

function LinkedInCard({ hookLine, body, name }: { hookLine: string; body: string; name: string }) {
  const [expanded, setExpanded] = useState(false);
  const fold = linkedinFold(hookLine, body);
  const full = fold.visible + (fold.hidden ? "\n\n" + fold.hidden : "");
  const shown = expanded || !fold.truncated ? full : fold.visible;
  const [first, ...rest] = shown.split("\n\n");
  return (
    <div className="rounded-lg border border-black/10 p-4" data-testid="sample-linkedin">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-black/40">LinkedIn post</p>
        <CopyButton text={`${hookLine}\n\n${body}`} label="Copy LinkedIn post" />
      </div>
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111111] text-sm font-semibold text-white" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6">{first}</p>
          {rest.length > 0 && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-black/70">{rest.join("\n\n")}</p>}
          {fold.truncated && !expanded && (
            <button type="button" onClick={() => setExpanded(true)} className="mt-1 text-xs font-medium text-black/55 hover:text-black" data-testid="sample-see-more">
              ...see more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type Phase = "idle" | "loading" | "error";

/**
 * Under an audit: an X post and a LinkedIn post written for the audited site, as examples of what Marlo's social
 * agents produce. Anyone with the link sees the saved samples; only the browser that ran the audit can start the
 * writing. Nothing is ever posted.
 */
export default function AuditPostsBlock({
  reportId,
  host,
  initialPosts,
  enabled,
  signupUrl,
}: {
  reportId: string;
  host: string;
  initialPosts: SamplePosts | null;
  enabled: boolean;
  signupUrl: string;
}) {
  const [posts, setPosts] = useState<SamplePosts | null>(initialPosts);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(readOwnerToken(reportId));
  }, [reportId]);

  async function write() {
    if (!token || phase === "loading") return;
    setPhase("loading");
    setError("");
    try {
      const res = await fetch(`/api/public/audit/report/${reportId}/posts`, { method: "POST", headers: { "x-report-token": token } });
      const data = (await res.json().catch(() => ({}))) as { posts?: SamplePosts; error?: string };
      if (!res.ok || !data.posts) throw new Error(data.error || "Could not write sample posts just now. Try again.");
      setPosts(data.posts);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not write sample posts just now. Try again.");
      setPhase("error");
    }
  }

  if (posts === null && !(enabled && token)) return null;
  const name = host;

  return (
    <section className="mt-8 rounded-xl border border-black/10 bg-white p-6" data-testid="audit-posts">
      <p className="text-xs font-semibold uppercase tracking-wider text-black/40">Sample posts</p>
      <h3 className="mt-2 text-lg font-medium">What Marlo would post for this site</h3>

      {posts === null && (
        <div className="mt-3">
          <p className="max-w-xl text-sm leading-6 text-black/55">
            Marlo reads the site and writes one X post and one LinkedIn post from what the site says. It takes a few seconds.
          </p>
          <button type="button" onClick={write} disabled={phase === "loading"} className="mt-4 h-10 rounded-lg bg-[#111111] px-5 text-sm font-medium text-white disabled:opacity-60">
            {phase === "loading" ? "Writing…" : "Write sample posts"}
          </button>
          {phase === "error" && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      )}

      {posts !== null && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {posts.x && <XCard text={posts.x.text} name={name} />}
            {posts.linkedin && <LinkedInCard hookLine={posts.linkedin.hookLine} body={posts.linkedin.body} name={name} />}
          </div>
          <p className="mt-3 text-xs leading-5 text-black/45" data-testid="posts-note">
            Sample drafts written by AI from the site&apos;s own text. Marlo never posts anything for you: review and edit before you use one.
          </p>
          <div className="mt-4 flex flex-col gap-3 rounded-lg bg-black/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-black/65">Get drafts like these for your own site, ready to review each day, with a free account.</p>
            <Link
              href={signupUrl}
              onClick={() => trackAuditEvent({ event: "signup_cta_clicked" })}
              className="shrink-0 rounded-lg bg-[#111111] px-4 py-2 text-sm font-medium text-white"
            >
              Get my drafts
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
