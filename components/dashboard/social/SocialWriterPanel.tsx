"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Pencil, Send, Sparkles, Trash2, Undo2 } from "lucide-react";
import SidePanel from "@/components/shared/SidePanel";
import { SkeletonLine } from "@/components/shared/Skeleton";
import { useToast } from "@/components/dashboard/Toast";
import { getPlatformConfig } from "@/lib/domain/social/platforms";
import { isNoSubredditError } from "@/lib/domain/social/errorDetection";
import { useSocialDraftList, useSocialDraftActions, type AnyDraft, type SocialPlatform, type DraftView } from "./useSocialDrafts";
import DraftPreviewCard from "./DraftPreviewCard";
import { useLockedFeature } from "@/components/plan/usePlan";
import { LockedLine } from "@/components/plan/LockedLine";
import type { FeatureId } from "@/lib/domain/plans/planMatrix";

const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = "inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
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

function DraftRow({ draft, platform, onOpen }: { draft: AnyDraft; platform: SocialPlatform; onOpen: () => void }) {
  let preview = "";
  if (platform === "x" && "text" in draft) {
    preview = draft.text;
  } else if (platform === "linkedin" && "hookLine" in draft) {
    preview = `${draft.hookLine}\n${draft.body}`;
  } else if (platform === "reddit" && "title" in draft) {
    preview = `${draft.title}\n${draft.body}`;
  }

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
        <p className="line-clamp-4 whitespace-pre-line break-words text-[13px] leading-relaxed text-gray-900">{preview.slice(0, 200)}</p>
      </button>
    </li>
  );
}

function DraftDetail({ draft, platform, onClose, onChange }: { draft: AnyDraft; platform: SocialPlatform; onClose: () => void; onChange: (draft: AnyDraft | null) => void }) {
  const { show } = useToast();
  const { update, remove, generate } = useSocialDraftActions(platform);
  const config = getPlatformConfig(platform);
  const [editing, setEditing] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  const busy = update.isPending || remove.isPending || generate.isPending;
  const isCurrent = draft.status === "draft";

  const copy = async () => {
    try {
      let text = "";
      if (platform === "x" && "text" in draft) {
        text = draft.text;
      } else if (platform === "linkedin" && "hookLine" in draft) {
        text = `${draft.hookLine}\n${draft.body}`;
      } else if (platform === "reddit" && "title" in draft) {
        text = `${draft.title}\n${draft.body}`;
      }
      await navigator.clipboard.writeText(text);
      show("Copied to clipboard.");
    } catch {
      show("Couldn't copy. Select the text and copy it manually.");
    }
  };

  const post = () => {
    const params: Record<string, string> = {};
    if (platform === "x" && "text" in draft) {
      params.text = draft.text;
    } else if (platform === "linkedin" && "hookLine" in draft) {
      params.text = `${draft.hookLine}\n${draft.body}`;
    } else if (platform === "reddit" && "subreddit" in draft && "title" in draft) {
      params.subreddit = draft.subreddit;
      params.title = draft.title;
      params.text = draft.body;
    }
    const url = config.composeUrl(params);
    window.open(url, "_blank", "noopener,noreferrer");
    show(`${config.name} is open in a new tab. Post it there, then come back and click Mark Complete.`);
  };

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

  const regenerate = () => {
    setRegenerateError(null);
    const params = platform === "reddit" ? { variants: 1, subreddit: "subreddit" in draft ? draft.subreddit.replace(/^r\//, "") : "" } : { variants: 1 };
    generate.mutate(params, {
      onSuccess: () => {
        show("1 new draft generated. Check the Current list.");
      },
      onError: (error) => {
        const msg = errorMessage(error, "Couldn't regenerate draft.");
        setRegenerateError(msg);
      },
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
      <button type="button" className={BTN} onClick={regenerate} disabled={editing || busy}>
        {generate.isPending ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Regenerate
      </button>
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
      title={`${config.name} Writer`}
      subtitle="Review, then post it yourself. Nothing is posted automatically."
      toolbar={toolbar}
      footer={
        <button type="button" onClick={destroy} disabled={busy} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-red-600 disabled:opacity-50">
          <Trash2 size={13} /> Delete draft
        </button>
      }
    >
      <div className="space-y-5">
        <DraftPreviewCard draft={draft} platform={platform} editing={editing} onEditChange={setEditing} onSave={(updated) => onChange(updated)} />

        {regenerateError && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
            <span className="flex-1">{regenerateError}</span>
          </div>
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

function UnlockedSocialWriterPanel({ platform, onClose }: { platform: SocialPlatform; onClose: () => void }) {
  const { show } = useToast();
  const [view, setView] = useState<DraftView>("current");
  const [selected, setSelected] = useState<AnyDraft | null>(null);
  const list = useSocialDraftList(platform, view);
  const { generate } = useSocialDraftActions(platform);
  const config = getPlatformConfig(platform);
  const drafts = list.data ?? [];

  const runGenerate = () => {
    const params = platform === "reddit" ? { variants: 3, subreddit: "" } : { variants: 3 };
    generate.mutate(params, {
      onSuccess: ({ drafts: created }) => {
        setView("current");
        show(`${created.length} new draft${created.length === 1 ? "" : "s"} ready to review.`);
      },
      onError: () => {
        // Error handling is done in the UI below, just silent for toast
      },
    });
  };

  if (selected) {
    return <DraftDetail key={selected.id} draft={selected} platform={platform} onClose={() => setSelected(null)} onChange={setSelected} />;
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
      title={`${config.name} Writer`}
      subtitle={`Post drafts written from your product info`}
      toolbar={toolbar}
      footer={
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">Drafts open in {config.name} for you to post. Nothing is sent automatically.</p>
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
            (() => {
              const msg = errorMessage(generate.error, "Couldn't generate drafts.");
              const noSub = isNoSubredditError(generate.error);
              return (
                <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
                  <span>{msg}</span>
                  {noSub ? (
                    <a href="/settings/agents" className="shrink-0 whitespace-nowrap font-medium underline hover:no-underline">
                      Open Settings
                    </a>
                  ) : (
                    <button type="button" onClick={runGenerate} className="shrink-0 whitespace-nowrap font-medium underline">
                      Retry
                    </button>
                  )}
                </div>
              );
            })()
          )}
          {generate.isPending && <DraftSkeleton />}
          {drafts.length === 0 && !generate.isPending ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-200 px-6 py-12 text-center">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-700">
                {platform === "x" && <XIcon size={16} />}
                {platform === "linkedin" && <span className="text-lg font-bold">in</span>}
                {platform === "reddit" && <span className="text-lg font-bold">r</span>}
              </span>
              <p className="text-[13px] font-medium text-gray-900">{view === "current" ? "No drafts to review" : "Nothing archived yet"}</p>
              <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-gray-500">
                {view === "current"
                  ? `Generate a few post ideas for ${config.name} based on what your product does. You review each one before anything is posted.`
                  : "Drafts you mark complete show up here."}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {drafts.map((d) => (
                <DraftRow key={d.id} draft={d} platform={platform} onOpen={() => setSelected(d)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </SidePanel>
  );
}

function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const PLATFORM_FEATURE: Record<SocialPlatform, FeatureId> = { x: "x_drafts", linkedin: "linkedin_drafts", reddit: "reddit_drafts" };

/** Plan gate: when the network's drafts are locked (enforcement on) the panel is one LockedLine; otherwise unchanged. */
export default function SocialWriterPanel({ platform, onClose }: { platform: SocialPlatform; onClose: () => void }) {
  const lock = useLockedFeature(PLATFORM_FEATURE[platform]);
  if (!lock.locked) return <UnlockedSocialWriterPanel platform={platform} onClose={onClose} />;
  const config = getPlatformConfig(platform);
  return (
    <SidePanel open onClose={onClose} width="md" title={`${config.name} Writer`} subtitle="Post drafts written from your product info">
      <LockedLine label={lock.label} minPlan={lock.minPlan} hint="Drafts are written from your product info. You review each one before anything is posted." />
    </SidePanel>
  );
}
