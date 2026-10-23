"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { useProject } from "@/lib/project-store";
import { getPlatformConfig } from "@/lib/domain/social/platforms";
import { useSocialDraftActions, type AnyDraft, type SocialPlatform } from "./useSocialDrafts";

const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = "inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50";

function CharCount({ current, max }: { current: number; max: number }) {
  const over = current > max;
  return (
    <span className={`text-xs tabular-nums ${over ? "font-semibold text-red-600" : current > Math.ceil(max * 0.93) ? "text-amber-600" : "text-gray-500"}`}>
      {current}/{max}
    </span>
  );
}

function TweetCard({ text, name }: { text: string; name: string }) {
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
        </div>
      </div>
    </div>
  );
}

function LinkedInCard({ hookLine, body, name }: { hookLine: string; body: string; name: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111111] text-[14px] font-semibold text-white" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[14px] font-semibold text-gray-900">{name}</span>
          </div>
          <div className="mt-2">
            <p className="whitespace-pre-wrap break-words text-[14px] font-semibold leading-relaxed text-gray-900">{hookLine}</p>
            <p className={`mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-gray-700 ${!expanded && "line-clamp-3"}`}>{body}</p>
            {!expanded && body.split("\n").length > 3 && (
              <button onClick={() => setExpanded(true)} className="mt-2 text-[12px] font-medium text-gray-600 hover:text-gray-900">
                ... see more
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RedditCard({ subreddit, title, body }: { subreddit: string; title: string; body: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 text-[12px] font-medium text-gray-500">r/{subreddit}</div>
      <h3 className="mb-2 text-[14px] font-semibold text-gray-900">{title}</h3>
      <p className={`text-[13px] leading-relaxed text-gray-700 ${!expanded && "line-clamp-4"}`}>{body}</p>
      {!expanded && body.split("\n").length > 4 && (
        <button onClick={() => setExpanded(true)} className="mt-2 text-[12px] font-medium text-gray-600 hover:text-gray-900">
          ... see more
        </button>
      )}
    </div>
  );
}

interface RedditSettings {
  settings: { subreddits: string[] };
}

export default function DraftPreviewCard({
  draft,
  platform,
  editing,
  onEditChange,
  onSave,
}: {
  draft: AnyDraft;
  platform: SocialPlatform;
  editing: boolean;
  onEditChange: (editing: boolean) => void;
  onSave: (draft: AnyDraft) => void;
}) {
  const { project } = useProject();
  const { update } = useSocialDraftActions(platform);
  const config = getPlatformConfig(platform);
  const name = project?.name ?? "Your product";
  const redditSettingsQuery = useQuery({
    queryKey: ["redditSettings"],
    queryFn: () => fetchJson<RedditSettings>("/api/agents/reddit/settings"),
    enabled: platform === "reddit",
  });

  const getDefaultSubreddit = () => {
    if (redditSettingsQuery.data?.settings.subreddits.length) {
      return redditSettingsQuery.data.settings.subreddits[0].replace(/^r\//, "");
    }
    return "";
  };

  const [values, setValues] = useState<Record<string, string>>(() => {
    if (platform === "x" && "text" in draft) return { text: draft.text } as Record<string, string>;
    if (platform === "linkedin" && "hookLine" in draft) return { hookLine: draft.hookLine, body: draft.body } as Record<string, string>;
    if (platform === "reddit" && "subreddit" in draft) {
      return { subreddit: draft.subreddit || getDefaultSubreddit(), title: draft.title, body: draft.body } as Record<string, string>;
    }
    return {};
  });

  const trimmedValues = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));

  const canSave = (() => {
    if (platform === "x" && "text" in values && "text" in draft) {
      const text = (values.text as string).trim();
      return text.length > 0 && text.length <= config.maxBodyChars && text !== draft.text;
    }
    if (platform === "linkedin" && "hookLine" in values && "hookLine" in draft) {
      const hookLine = (values.hookLine as string).trim();
      const body = (values.body as string).trim();
      const combined = hookLine.length + body.length;
      return hookLine.length > 0 && body.length > 0 && combined <= config.maxBodyChars && (hookLine !== draft.hookLine || body !== draft.body);
    }
    if (platform === "reddit" && "title" in values && "title" in draft) {
      const title = (values.title as string).trim();
      const body = (values.body as string).trim();
      return (
        title.length > 0 &&
        body.length > 0 &&
        title.length <= (config.maxTitleChars ?? 300) &&
        body.length <= config.maxBodyChars &&
        (title !== draft.title || body !== draft.body)
      );
    }
    return false;
  })();

  const save = () => {
    update.mutate(
      { id: draft.id, patch: trimmedValues },
      {
        onSuccess: ({ draft: next }) => {
          onSave(next);
          onEditChange(false);
        },
        onError: () => {
          // Error is handled by hook
        },
      }
    );
  };

  if (editing) {
    return (
      <div className="space-y-3">
        {platform === "x" && "text" in values && (
          <>
            <div className="space-y-2">
              <label htmlFor={`${platform}-edit`} className="text-[12px] font-medium text-gray-700">
                Edit post
              </label>
              <textarea
                id={`${platform}-edit`}
                value={values.text}
                onChange={(e) => setValues({ ...values, text: e.target.value })}
                rows={8}
                autoFocus
                className="w-full resize-y rounded-xl border border-gray-200 bg-white p-3 text-[14px] leading-relaxed text-gray-900 outline-none focus:border-gray-400"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CharCount current={(values.text as string).length} max={config.maxBodyChars} />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={BTN}
                  onClick={() => {
                    if ("text" in draft) {
                      setValues({ text: draft.text });
                      onEditChange(false);
                    }
                  }}
                  disabled={update.isPending}
                >
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={save} disabled={!canSave || update.isPending}>
                  {update.isPending && <Loader2 size={13} className="animate-spin" />} Save
                </button>
              </div>
            </div>
          </>
        )}

        {platform === "linkedin" && "hookLine" in values && (
          <>
            <div className="space-y-2">
              <label htmlFor={`${platform}-hook`} className="text-[12px] font-medium text-gray-700">
                Hook line
              </label>
              <input
                id={`${platform}-hook`}
                type="text"
                value={values.hookLine}
                onChange={(e) => setValues({ ...values, hookLine: e.target.value })}
                autoFocus
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[14px] text-gray-900 outline-none focus:border-gray-400"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${platform}-body`} className="text-[12px] font-medium text-gray-700">
                Body
              </label>
              <textarea
                id={`${platform}-body`}
                value={values.body}
                onChange={(e) => setValues({ ...values, body: e.target.value })}
                rows={6}
                className="w-full resize-y rounded-xl border border-gray-200 bg-white p-3 text-[14px] leading-relaxed text-gray-900 outline-none focus:border-gray-400"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CharCount
                current={(values.hookLine as string).length + (values.body as string).length}
                max={config.maxBodyChars}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={BTN}
                  onClick={() => {
                    if ("hookLine" in draft && "body" in draft) {
                      setValues({ hookLine: draft.hookLine, body: draft.body });
                      onEditChange(false);
                    }
                  }}
                  disabled={update.isPending}
                >
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={save} disabled={!canSave || update.isPending}>
                  {update.isPending && <Loader2 size={13} className="animate-spin" />} Save
                </button>
              </div>
            </div>
          </>
        )}

        {platform === "reddit" && "title" in values && (
          <>
            <div className="space-y-2">
              <label htmlFor={`${platform}-sub`} className="text-[12px] font-medium text-gray-700">
                Subreddit
              </label>
              <input
                id={`${platform}-sub`}
                type="text"
                value={values.subreddit}
                onChange={(e) => setValues({ ...values, subreddit: e.target.value })}
                autoFocus
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[14px] text-gray-900 outline-none focus:border-gray-400"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${platform}-title`} className="text-[12px] font-medium text-gray-700">
                Title
              </label>
              <input
                id={`${platform}-title`}
                type="text"
                value={values.title}
                onChange={(e) => setValues({ ...values, title: e.target.value })}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[14px] text-gray-900 outline-none focus:border-gray-400"
              />
              <CharCount current={(values.title as string).length} max={config.maxTitleChars ?? 300} />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${platform}-body`} className="text-[12px] font-medium text-gray-700">
                Body
              </label>
              <textarea
                id={`${platform}-body`}
                value={values.body}
                onChange={(e) => setValues({ ...values, body: e.target.value })}
                rows={6}
                className="w-full resize-y rounded-xl border border-gray-200 bg-white p-3 text-[14px] leading-relaxed text-gray-900 outline-none focus:border-gray-400"
              />
              <CharCount current={(values.body as string).length} max={config.maxBodyChars} />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  if ("subreddit" in draft && "title" in draft && "body" in draft) {
                    setValues({ subreddit: draft.subreddit, title: draft.title, body: draft.body });
                    onEditChange(false);
                  }
                }}
                disabled={update.isPending}
              >
                Cancel
              </button>
              <button type="button" className={BTN_PRIMARY} onClick={save} disabled={!canSave || update.isPending}>
                {update.isPending && <Loader2 size={13} className="animate-spin" />} Save
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {platform === "x" && "text" in draft && <TweetCard text={draft.text} name={name} />}
      {platform === "linkedin" && "hookLine" in draft && <LinkedInCard hookLine={draft.hookLine} body={draft.body} name={name} />}
      {platform === "reddit" && "subreddit" in draft && <RedditCard subreddit={draft.subreddit} title={draft.title} body={draft.body} />}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{draft.angle}</span>
          {draft.edited && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Edited</span>}
        </div>
        {platform === "x" && "text" in draft && <CharCount current={draft.text.length} max={config.maxBodyChars} />}
        {platform === "linkedin" && "hookLine" in draft && (
          <CharCount current={draft.hookLine.length + draft.body.length} max={config.maxBodyChars} />
        )}
        {platform === "reddit" && "title" in draft && (
          <CharCount current={draft.title.length + draft.body.length} max={config.maxBodyChars + (config.maxTitleChars ?? 300)} />
        )}
      </div>
    </>
  );
}
