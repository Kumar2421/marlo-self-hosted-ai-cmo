"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Search, Undo2, X } from "lucide-react";
import SidePanel from "@/components/shared/SidePanel";
import { SkeletonLine } from "@/components/shared/Skeleton";
import { useToast } from "@/components/dashboard/Toast";
import { useProject } from "@/lib/project-store";
import { useSenderProfile } from "@/components/dashboard/leads/outreach/useSenderProfile";
import { buildReachMessage, REACH_LIMITS } from "@/lib/domain/leads/reach";
import { foundLabel, groupRequests, rulesUrl, type RequestRow } from "@/lib/domain/leads/intent/redditRequestRows";
import { useRedditRequestActions, useRedditRequests } from "./useRedditRequests";

const BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Posts | Replies, shown at the top of the Reddit panel in both views. */
export function RedditModeTabs({ mode, onChange, replies }: { mode: "posts" | "replies"; onChange: (mode: "posts" | "replies") => void; replies: number }) {
  return (
    <div role="tablist" aria-label="Reddit" className="flex gap-1">
      {(["posts", "replies"] as const).map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={mode === name}
          onClick={() => onChange(name)}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${mode === name ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          {name === "posts" ? "Posts" : "Replies"}
          {name === "replies" && replies > 0 ? <span className="ml-1.5 rounded-full bg-[#00ab92] px-1.5 py-0.5 text-[10px] font-semibold text-white">{replies}</span> : null}
        </button>
      ))}
    </div>
  );
}

function RequestSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading replies">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
          <SkeletonLine className="mb-3 w-24" />
          <div className="space-y-2.5">
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RequestCard({ row, onOpen }: { row: RequestRow; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="reply-card"
        className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">r/{row.subreddit}</span>
          <span className="text-xs text-gray-500">{foundLabel(row.createdAt)}</span>
          {row.status === "posted" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              <Check size={10} /> Posted
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-gray-900">{row.title}</p>
        {row.quote ? <p className="mt-1 line-clamp-2 text-xs italic leading-snug text-gray-500">“{row.quote}”</p> : null}
        <p className="mt-2 line-clamp-2 whitespace-pre-line break-words text-[12px] leading-relaxed text-gray-600">
          {row.reply ? row.reply : "Reply draft ready to review."}
        </p>
      </button>
    </li>
  );
}

function RequestDetail({ row, fallbackReply, onBack, onClose, onSwitchMode, replies }: { row: RequestRow; fallbackReply: string; onBack: () => void; onClose: () => void; onSwitchMode: (mode: "posts" | "replies") => void; replies: number }) {
  const { show } = useToast();
  const { saveReply, setStatus } = useRedditRequestActions();
  const original = row.reply || fallbackReply;
  const [text, setText] = useState(original);
  const [copied, setCopied] = useState(false);
  const changed = text.trim() !== original.trim();
  const tooLong = text.length > REACH_LIMITS.reddit;
  const busy = saveReply.isPending || setStatus.isPending;

  async function copyAndOpen() {
    if (changed && !tooLong) saveReply.mutate({ id: row.id, reply: text });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      show("Reply copied. Paste it into the thread, then come back and mark it posted.");
    } catch {
      setCopied(false);
      show("Couldn't copy automatically. Select the reply and copy it by hand.");
    }
    if (row.url) window.open(row.url, "_blank", "noopener,noreferrer");
  }

  const save = () =>
    saveReply.mutate({ id: row.id, reply: text }, { onSuccess: () => show("Reply saved."), onError: (err) => show(errorMessage(err, "Couldn't save the reply.")) });

  const mark = (status: "posted" | "dismissed" | "new", message: string) =>
    setStatus.mutate(
      { id: row.id, status },
      {
        onSuccess: () => {
          show(message);
          if (status !== "new") onBack();
        },
        onError: (err) => show(errorMessage(err, "Couldn't update this reply.")),
      },
    );

  const toolbar = (
    <div className="flex flex-col gap-2">
      <RedditModeTabs mode="replies" onChange={onSwitchMode} replies={replies} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PRIMARY} onClick={copyAndOpen} disabled={!text.trim() || tooLong}>
          {copied ? <Check size={13} /> : <Copy size={13} />} Copy reply and open thread <ExternalLink size={11} />
        </button>
        {row.status === "posted" ? (
          <button type="button" className={BTN} onClick={() => mark("new", "Moved back to To answer.")} disabled={busy}>
            <Undo2 size={13} /> Move back
          </button>
        ) : (
          <button type="button" className={BTN} onClick={() => mark("posted", "Marked as posted.")} disabled={busy}>
            {setStatus.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} I posted it
          </button>
        )}
        <button type="button" className={BTN} onClick={onBack}>
          Back to list
        </button>
      </div>
    </div>
  );

  return (
    <SidePanel
      open
      onClose={onClose}
      width="md"
      title={`Reply in r/${row.subreddit}`}
      subtitle="Review and edit, then post it yourself. Nothing is posted automatically."
      toolbar={toolbar}
      footer={
        <button
          type="button"
          onClick={() => mark("dismissed", "Dismissed. It won't show again.")}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-red-600 disabled:opacity-50"
        >
          <X size={13} /> Dismiss this thread
        </button>
      }
    >
      <div className="space-y-5">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">r/{row.subreddit}</span>
            <span className="text-xs text-gray-500">{foundLabel(row.createdAt)}</span>
          </div>
          <p className="text-[14px] font-semibold leading-snug text-gray-900" data-testid="reply-thread-title">{row.title}</p>
          {row.quote ? (
            <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
              <span className="font-medium text-gray-700">Why it fits: </span>
              <span className="italic">“{row.quote}”</span>
            </p>
          ) : null}
          {row.url ? (
            <a href={row.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900">
              Open the thread <ExternalLink size={11} />
            </a>
          ) : null}
        </section>

        <section>
          <label htmlFor="reply-text" className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">
            Your reply
            {changed ? (
              <button type="button" onClick={save} disabled={busy || tooLong} className="font-medium normal-case text-gray-700 underline underline-offset-2 hover:text-gray-900 disabled:opacity-50">
                {saveReply.isPending ? "Saving…" : "Save changes"}
              </button>
            ) : (
              <span className="font-medium normal-case text-gray-400">{row.reply ? "Draft by Marlo" : "Template draft"}</span>
            )}
          </label>
          <textarea
            id="reply-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            data-testid="reply-text"
            className="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] leading-relaxed text-gray-900 focus:border-gray-400 focus:outline-none"
          />
          <p className={`mt-1 text-right text-xs ${tooLong ? "text-red-600" : "text-gray-400"}`} data-testid="reply-count">
            {text.length} / {REACH_LIMITS.reddit}
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Before you post</h3>
          <p className="text-[13px] leading-relaxed text-gray-700" data-testid="reply-rules-tip">
            Many subreddits ban promotion or require a flair. Read the rules first, answer the question helpfully, and keep any mention of your product honest and short.
          </p>
          <a href={rulesUrl(row.subreddit)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900">
            Read r/{row.subreddit} rules <ExternalLink size={11} />
          </a>
        </section>
      </div>
    </SidePanel>
  );
}

/**
 * Reddit "Replies": real threads where someone asks for what the user sells, each with a reply draft to edit and post
 * by hand. Found by searching public Reddit posts from what the website sells; Marlo never posts.
 */
export default function RedditRepliesPanel({ onClose, onSwitchMode }: { onClose: () => void; onSwitchMode: (mode: "posts" | "replies") => void }) {
  const { show } = useToast();
  const { project } = useProject();
  const [sender] = useSenderProfile();
  const list = useRedditRequests();
  const { find } = useRedditRequestActions();
  const [filter, setFilter] = useState<"toAnswer" | "posted">("toAnswer");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const groups = useMemo(() => groupRequests(rows), [rows]);
  const shown = filter === "toAnswer" ? groups.toAnswer : groups.posted;
  const opened = openId ? rows.find((r) => r.id === openId) ?? null : null;

  const runFind = () =>
    find.mutate(undefined, {
      onSuccess: (res) => {
        setFilter("toAnswer");
        const n = Array.isArray(res.leads) ? res.leads.length : 0;
        show(n > 0 ? `Found ${n} ${n === 1 ? "request" : "requests"} to answer.` : (res.message ?? "No new requests this time."));
      },
    });

  if (opened) {
    const fallbackReply = buildReachMessage("reddit", { lead: { name: opened.title, lead_type: "intent" }, sender, projectName: project?.name ?? "" });
    return <RequestDetail key={opened.id} row={opened} fallbackReply={fallbackReply} onBack={() => setOpenId(null)} onClose={onClose} onSwitchMode={onSwitchMode} replies={groups.toAnswer.length} />;
  }

  const toolbar = (
    <div className="flex flex-col gap-2">
      <RedditModeTabs mode="replies" onChange={onSwitchMode} replies={groups.toAnswer.length} />
      <div role="tablist" aria-label="Reply lists" className="flex gap-1">
        {(["toAnswer", "posted"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={filter === name}
            onClick={() => setFilter(name)}
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${filter === name ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:bg-gray-50"}`}
          >
            {name === "toAnswer" ? `To answer (${groups.toAnswer.length})` : `Posted (${groups.posted.length})`}
          </button>
        ))}
      </div>
    </div>
  );

  const findButton = (
    <button type="button" onClick={runFind} disabled={find.isPending} className={`${BTN_PRIMARY} w-full shrink-0 justify-center whitespace-nowrap py-2 sm:w-auto`}>
      {find.isPending ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
      {find.isPending ? "Searching Reddit…" : "Find requests now"}
    </button>
  );

  return (
    <SidePanel
      open
      onClose={onClose}
      width="md"
      title="Reddit Writer"
      subtitle="Threads where someone asks for what you sell, with a reply to edit"
      toolbar={toolbar}
      footer={
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">Replies open in Reddit for you to post. Nothing is posted automatically.</p>
          {findButton}
        </div>
      }
    >
      {list.isPending ? (
        <RequestSkeleton />
      ) : list.isError ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
          <span>{errorMessage(list.error, "Couldn't load replies.")}</span>
          <button type="button" onClick={() => list.refetch()} className="shrink-0 font-medium underline">
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {find.isError && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
              <span>{errorMessage(find.error, "Couldn't search Reddit.")}</span>
              <button type="button" onClick={runFind} className="shrink-0 whitespace-nowrap font-medium underline">
                Retry
              </button>
            </div>
          )}
          {find.isPending && <RequestSkeleton />}
          {shown.length === 0 && !find.isPending ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-200 px-6 py-12 text-center" data-testid="reply-empty">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-700">
                <span className="text-lg font-bold">r</span>
              </span>
              <p className="text-[13px] font-medium text-gray-900">{filter === "toAnswer" ? "No threads to answer yet" : "Nothing posted yet"}</p>
              <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-gray-500">
                {filter === "toAnswer"
                  ? "Marlo searches public Reddit posts for people asking for what you sell, using what your website says. Most searches find a few; some find none."
                  : "Replies you mark as posted show up here."}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {shown.map((r) => (
                <RequestCard key={r.id} row={r} onOpen={() => setOpenId(r.id)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </SidePanel>
  );
}
