"use client";

import { useState } from "react";
import { Check, Copy, Heart, Loader2, MessageCircle, Pencil, Repeat2, Send, Share, Sparkles, Trash2, Undo2 } from "lucide-react";
import SidePanel from "@/components/shared/SidePanel";
import { SkeletonLine } from "@/components/shared/Skeleton";
import { useToast } from "@/components/dashboard/Toast";
import { countTweetChars, intentUrl, MAX_TWEET_CHARS } from "@/lib/domain/x/draftPost";
import type { XDraft, XDraftView } from "@/lib/domain/x/xDraftTypes";
import { useProject } from "@/lib/project-store";
import { useXDraftActions, useXDraftList } from "./useXDrafts";

const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = "inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50";

function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function CharCount({ text }: { text: string }) {
  const n = countTweetChars(text);
  const over = n > MAX_TWEET_CHARS;
  return (
    <span className={`text-xs tabular-nums ${over ? "font-semibold text-red-600" : n > 260 ? "text-amber-600" : "text-gray-500"}`}>
      {n}/{MAX_TWEET_CHARS}
    </span>
  );
}

function DraftSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading drafts">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
          <SkeletonLine className="mb-3 w-20" />
          <div className="space-y-2.5">
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-5/6" />
            <SkeletonLine className="w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DraftRow({ draft, onOpen }: { draft: XDraft; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-900"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{draft.angle}</span>
          {draft.edited && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Edited</span>}
          {draft.status === "completed" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              <Check size={10} /> Completed
            </span>
          )}
        </div>
        <p className="line-clamp-4 whitespace-pre-line break-words text-[13px] leading-relaxed text-gray-900">{draft.text}</p>
        <div className="mt-2.5">
          <CharCount text={draft.text} />
        </div>
      </button>
    </li>
  );
}

function TweetCard({ text }: { text: string }) {
  const { project } = useProject();
  const name = project?.name ?? "Your product";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111111] text-[14px] font-semibold text-white" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[14px] font-semibold text-gray-900">{name}</span>
            <span className="shrink-0 text-[13px] text-gray-500">@yourhandle</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-gray-900">{text}</p>
          <div className="mt-3 flex max-w-xs items-center justify-between text-gray-300" aria-hidden="true">
            <MessageCircle size={15} />
            <Repeat2 size={16} />
            <Heart size={15} />
            <Share size={15} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DraftDetail({ draft, onClose, onChange }: { draft: XDraft; onClose: () => void; onChange: (draft: XDraft | null) => void }) {
  const { show } = useToast();
  const { update, remove } = useXDraftActions();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(draft.text);

  const busy = update.isPending || remove.isPending;
  const isCurrent = draft.status === "draft";
  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && countTweetChars(trimmed) <= MAX_TWEET_CHARS && trimmed !== draft.text;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.text);
      show("Copied to clipboard.");
    } catch {
      show("Couldn't copy. Select the text and copy it manually.");
    }
  };

  const post = () => {
    window.open(intentUrl(draft.text), "_blank", "noopener,noreferrer");
    show("X is open in a new tab. Post it there, then come back and click Mark Complete.");
  };

  const save = () =>
    update.mutate(
      { id: draft.id, patch: { text: trimmed } },
      {
        onSuccess: ({ draft: next }) => {
          onChange(next);
          setEditing(false);
          show("Draft updated.");
        },
        onError: (err) => show(errorMessage(err, "Couldn't save your edit.")),
      }
    );

  const setStatus = (status: "completed" | "draft") =>
    update.mutate(
      { id: draft.id, patch: { status } },
      {
        onSuccess: () => {
          show(status === "completed" ? "Marked complete. Moved to Archived." : "Moved back to Current.");
          onChange(null);
        },
        onError: (err) => show(errorMessage(err, "Couldn't update this draft.")),
      }
    );

  const destroy = () => {
    if (!window.confirm("Delete this draft? This can't be undone.")) return;
    remove.mutate(draft.id, {
      onSuccess: () => {
        show("Draft deleted.");
        onChange(null);
      },
      onError: (err) => show(errorMessage(err, "Couldn't delete this draft.")),
    });
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {isCurrent ? (
        <button type="button" className={BTN_PRIMARY} onClick={() => setStatus("completed")} disabled={busy}>
          {update.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Mark Complete
        </button>
      ) : (
        <button type="button" className={BTN} onClick={() => setStatus("draft")} disabled={busy}>
          <Undo2 size={13} /> Move to Current
        </button>
      )}
      <button type="button" className={BTN} onClick={post} disabled={editing || busy}>
        <Send size={13} /> Post
      </button>
      <button type="button" className={BTN} onClick={copy} aria-label="Copy text" disabled={editing}>
        <Copy size={13} /> Copy
      </button>
      <button type="button" className={BTN} onClick={() => setEditing(true)} disabled={editing || busy}>
        <Pencil size={13} /> Edit
      </button>
    </div>
  );

  return (
    <SidePanel
      open
      onClose={onClose}
      width="md"
      title="X Writer"
      subtitle="Review, then post it yourself. Nothing is posted automatically."
      toolbar={toolbar}
      footer={
        <button type="button" onClick={destroy} disabled={busy} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-red-600 disabled:opacity-50">
          <Trash2 size={13} /> Delete draft
        </button>
      }
    >
      <div className="space-y-5">
        {editing ? (
          <div className="space-y-2">
            <label htmlFor="x-draft-text" className="text-[12px] font-medium text-gray-700">
              Edit post
            </label>
            <textarea
              id="x-draft-text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={8}
              autoFocus
              className="w-full resize-y rounded-xl border border-gray-200 bg-white p-3 text-[14px] leading-relaxed text-gray-900 outline-none focus:border-gray-400"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CharCount text={value} />
              <div className="flex gap-2">
                <button type="button" className={BTN} onClick={() => { setValue(draft.text); setEditing(false); }} disabled={update.isPending}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={save} disabled={!canSave || update.isPending}>
                  {update.isPending && <Loader2 size={13} className="animate-spin" />} Save
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <TweetCard text={draft.text} />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{draft.angle}</span>
                {draft.edited && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Edited</span>}
              </div>
              <CharCount text={draft.text} />
            </div>
          </>
        )}

        {draft.whyThisWorks && (
          <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Why this works</h3>
            <p className="text-[13px] leading-relaxed text-gray-700">{draft.whyThisWorks}</p>
          </section>
        )}
      </div>
    </SidePanel>
  );
}

export default function XWriterPanel({ onClose }: { onClose: () => void }) {
  const { show } = useToast();
  const [view, setView] = useState<XDraftView>("current");
  const [selected, setSelected] = useState<XDraft | null>(null);
  const list = useXDraftList(view);
  const { generate } = useXDraftActions();
  const drafts = list.data ?? [];

  const runGenerate = () =>
    generate.mutate(undefined, {
      onSuccess: ({ drafts: created }) => {
        setView("current");
        show(`${created.length} new draft${created.length === 1 ? "" : "s"} ready to review.`);
      },
      onError: (err) => show(errorMessage(err, "Couldn't generate drafts.")),
    });

  if (selected) {
    return <DraftDetail key={selected.id} draft={selected} onClose={() => setSelected(null)} onChange={setSelected} />;
  }

  const toolbar = (
    <div role="tablist" aria-label="Draft lists" className="flex gap-1">
      {(["current", "archived"] as const).map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={view === name}
          onClick={() => setView(name)}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${view === name ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          {name === "current" ? "Current" : "Archived"}
        </button>
      ))}
    </div>
  );

  const generateButton = (
    <button type="button" onClick={runGenerate} disabled={generate.isPending} className={`${BTN_PRIMARY} w-full justify-center py-2 sm:w-auto`}>
      {generate.isPending ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
      {generate.isPending ? "Writing drafts…" : "Generate new drafts"}
    </button>
  );

  return (
    <SidePanel
      open
      onClose={onClose}
      width="md"
      title="X Writer"
      subtitle="Post drafts written from your product info"
      toolbar={toolbar}
      footer={
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">Drafts open in X for you to post. Nothing is sent automatically.</p>
          {generateButton}
        </div>
      }
    >
      {list.isPending ? (
        <DraftSkeleton />
      ) : list.isError ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
          <span>{errorMessage(list.error, "Couldn't load drafts.")}</span>
          <button type="button" onClick={() => list.refetch()} className="shrink-0 font-medium underline">
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {generate.isError && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
              <span>{errorMessage(generate.error, "Couldn't generate drafts.")}</span>
              <button type="button" onClick={runGenerate} className="shrink-0 font-medium underline">
                Retry
              </button>
            </div>
          )}
          {generate.isPending && <DraftSkeleton />}
          {drafts.length === 0 && !generate.isPending ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-200 px-6 py-12 text-center">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-700">
                <XIcon size={16} />
              </span>
              <p className="text-[13px] font-medium text-gray-900">{view === "current" ? "No drafts to review" : "Nothing archived yet"}</p>
              <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-gray-500">
                {view === "current"
                  ? "Generate a few post ideas based on what your product does. You review each one before anything is posted."
                  : "Drafts you mark complete show up here."}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {drafts.map((d) => (
                <DraftRow key={d.id} draft={d} onOpen={() => setSelected(d)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </SidePanel>
  );
}
