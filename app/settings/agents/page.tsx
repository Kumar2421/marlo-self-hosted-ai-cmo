"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import { SkeletonLine } from "@/components/shared/Skeleton";
import { useRedditSettings } from "@/components/settings/useRedditSettings";
import { addKeyword, addSubreddit, REDDIT_LIMITS, type AddResult, type RedditSettings } from "@/lib/domain/reddit/redditSettings";

/** Chips with an input: Enter adds, X removes. Validation lives in the domain `add` function. */
function ChipField({
  label,
  max,
  items,
  placeholder,
  disabled,
  loading,
  add,
  onChange,
}: {
  label: string;
  max: number;
  items: string[];
  placeholder: string;
  disabled: boolean;
  loading: boolean;
  add: (list: string[], raw: string) => AddResult;
  onChange: (next: string[]) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function commit(result: AddResult, clearDraft: boolean) {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    if (clearDraft) setDraft("");
    const failure = await onChange(result.list);
    if (failure) setError(failure);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px] text-gray-600">
        {label}
        <span className="text-ui-subtle">
          {items.length}/{max}
        </span>
      </div>
      {loading ? (
        <SkeletonLine className="h-9 w-full" />
      ) : (
        <>
          {items.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {items.map((item) => (
                <span key={item} className="flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-2.5 pr-1.5 text-[12px] text-gray-700">
                  {item}
                  <button
                    type="button"
                    aria-label={`Remove ${item}`}
                    disabled={disabled}
                    onClick={() => void commit({ ok: true, list: items.filter((x) => x !== item) }, false)}
                    className="rounded-full p-0.5 text-ui-subtle hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            value={draft}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (draft.trim()) void commit(add(items, draft), true);
            }}
            placeholder={items.length >= max ? "Limit reached" : placeholder}
            className="min-w-0 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 disabled:opacity-50"
          />
        </>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export default function AgentsSettingsPage() {
  const { show } = useToast();
  const reddit = useRedditSettings();

  /** Persist a settings change. Optimistic with rollback (in the hook); resolves to an error message or null. */
  async function saveReddit(patch: Partial<RedditSettings>): Promise<string | null> {
    try {
      await reddit.save.mutateAsync({ ...reddit.settings, ...patch });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Could not save. Your change was not kept.";
    }
  }

  return (
    <div className="min-w-0 max-w-3xl">
      <div className="mb-4">
        <h1 className="text-[15px] font-semibold text-gray-900">Agents</h1>
        <p className="text-[13px] text-gray-500">Where the Reddit agent looks for threads.</p>
      </div>

      <div className="mb-4 rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff4500] text-[11px] text-white">
            🤖
          </span>
          <div>
            <div className="text-[13px] font-semibold text-gray-900">Reddit</div>
            <div className="text-[12px] text-gray-500">Region, subreddits and keywords for the next run.</div>
          </div>
        </div>
        <label htmlFor="reddit-region" className="mb-1 flex items-center gap-1 text-[12px] text-gray-600">
          Search region
        </label>
        <select
          id="reddit-region"
          value={reddit.settings.country}
          onChange={async (e) => {
            const failure = await saveReddit({ country: e.target.value === "us" ? "us" : "global" });
            if (failure) show(failure);
          }}
          disabled={reddit.isLoading || reddit.save.isPending}
          className="mb-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 disabled:opacity-50"
        >
          <option value="global">Global (no filter)</option>
          <option value="us">United States only</option>
        </select>
        <div className="mb-3">
          <ChipField
            label="Priority subreddits"
            max={REDDIT_LIMITS.subreddits}
            items={reddit.settings.subreddits}
            placeholder="Add a subreddit, like r/startups, and press Enter"
            disabled={false}
            loading={reddit.isLoading}
            add={addSubreddit}
            onChange={(subreddits) => saveReddit({ subreddits })}
          />
        </div>
        <ChipField
          label="Search keywords"
          max={REDDIT_LIMITS.keywords}
          items={reddit.settings.keywords}
          placeholder="Add a keyword and press Enter"
          disabled={false}
          loading={reddit.isLoading}
          add={addKeyword}
          onChange={(keywords) => saveReddit({ keywords })}
        />
        {reddit.isError && <p className="mt-2 text-xs text-red-600">Could not load your saved Reddit settings. Refresh to try again.</p>}
        <p className="mt-2 text-xs text-ui-subtle">Priority subreddits, keywords and region save as you change them and focus the next Reddit run.</p>
      </div>
    </div>
  );
}
