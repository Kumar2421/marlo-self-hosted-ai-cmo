"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { SiReddit } from "react-icons/si";
import { useToast } from "@/components/dashboard/Toast";
import { SkeletonLine } from "@/components/shared/Skeleton";
import { useRedditSettings } from "@/components/settings/useRedditSettings";
import { BTN_GHOST, BTN_PRIMARY, CARD, FOCUS_RING, INPUT, SettingsPageHeader } from "@/components/settings/ui";
import { addKeyword, addSubreddit, REDDIT_LIMITS, type AddResult, type RedditSettings } from "@/lib/domain/reddit/redditSettings";
import {
  canSave,
  isDraftDirty,
  nextSaveStatus,
  SAVE_ERROR_MESSAGE,
  settingsForSave,
  type SaveStatus,
} from "@/lib/domain/reddit/redditSettingsDraft";

/** Chips with an input: Enter adds, X removes. Edits only change the local draft; validation lives in the domain `add` function. */
function ChipField({
  id,
  label,
  max,
  items,
  placeholder,
  disabled,
  loading,
  add,
  onChange,
}: {
  id: string;
  label: string;
  max: number;
  items: string[];
  placeholder: string;
  disabled: boolean;
  loading: boolean;
  add: (list: string[], raw: string) => AddResult;
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function commit(result: AddResult, clearText: boolean) {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    if (clearText) setText("");
    onChange(result.list);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-ui-text">
        <label htmlFor={id}>{label}</label>
        <span className="text-xs font-normal text-ui-subtle">
          {items.length}/{max}
        </span>
      </div>
      {loading ? (
        <SkeletonLine className="h-9 w-full" />
      ) : (
        <>
          {items.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={`Added ${label.toLowerCase()}`}>
              {items.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-1 rounded-full border border-ui-border bg-ui-surface-sunken py-1 pl-3 pr-1.5 text-[13px] text-ui-text"
                >
                  {item}
                  <button
                    type="button"
                    aria-label={`Remove ${item}`}
                    disabled={disabled}
                    onClick={() => commit({ ok: true, list: items.filter((x) => x !== item) }, false)}
                    className={`relative flex h-6 w-6 items-center justify-center rounded-full text-ui-subtle after:absolute after:-inset-2.5 after:content-[''] hover:bg-ui-border hover:text-ui-text disabled:opacity-50 ${FOCUS_RING}`}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            id={id}
            value={text}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (text.trim()) commit(add(items, text), true);
            }}
            aria-describedby={error ? `${id}-error` : undefined}
            placeholder={items.length >= max ? "Limit reached" : placeholder}
            className={INPUT}
          />
        </>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-ui-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

/** Discard + Save changes + the save confirmation. Rendered twice (header, and the bottom of the card on phones). */
function SaveActions({
  status,
  fading,
  loading,
  onSave,
  onDiscard,
  where,
}: {
  status: SaveStatus;
  fading: boolean;
  loading: boolean;
  onSave: () => void;
  onDiscard: () => void;
  where: "header" | "footer";
}) {
  const saving = status === "saving";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`reddit-save-bar-${where}`}>
      <span
        role="status"
        aria-live="polite"
        className={`flex min-h-6 items-center gap-1 text-[13px] transition-opacity duration-700 motion-reduce:transition-none ${
          status === "saved" ? "font-medium text-ui-success-text" : "text-ui-subtle"
        } ${status === "saved" && fading ? "opacity-0" : "opacity-100"}`}
      >
        {status === "saved" && (
          <>
            <Check size={14} aria-hidden="true" /> Saved
          </>
        )}
        {status === "dirty" && "Unsaved changes"}
        {status === "error" && "Not saved"}
      </span>
      <button
        type="button"
        onClick={onDiscard}
        disabled={loading || !(status === "dirty" || status === "error")}
        className={BTN_GHOST}
      >
        Discard
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={loading || !canSave(status)}
        aria-busy={saving}
        className={BTN_PRIMARY}
      >
        {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
        {saving ? "Saving..." : "Save changes"}
      </button>
    </div>
  );
}

export default function AgentsSettingsPage() {
  const { show } = useToast();
  const reddit = useRedditSettings();
  const saved = reddit.settings;

  // The draft is null until the first edit, so the form follows the saved settings (including their first load).
  const [draft, setDraft] = useState<RedditSettings | null>(null);
  const current = draft ?? saved;
  const [status, dispatch] = useReducer(nextSaveStatus, "idle" as SaveStatus);
  const [fading, setFading] = useState(false);
  const inFlight = useRef(false);

  function edit(patch: Partial<RedditSettings>) {
    if (status === "saving") return;
    const next = { ...current, ...patch };
    setDraft(next);
    dispatch({ type: "edit", dirty: isDraftDirty(saved, next) });
  }

  async function save() {
    if (!draft || !canSave(status) || inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "save" });
    try {
      // One PUT with the whole draft; the hook updates the cache optimistically and rolls it back on failure.
      await reddit.save.mutateAsync(settingsForSave(draft));
      setDraft(null);
      setFading(false);
      dispatch({ type: "succeeded" });
    } catch {
      // The draft stays exactly as the user left it, so they can retry.
      dispatch({ type: "failed" });
      show(SAVE_ERROR_MESSAGE);
    } finally {
      inFlight.current = false;
    }
  }

  function discard() {
    setDraft(null);
    dispatch({ type: "discard" });
  }

  // The "Saved" confirmation fades out, then the status returns to idle.
  useEffect(() => {
    if (status !== "saved") return;
    const fadeTimer = window.setTimeout(() => setFading(true), 2500);
    const doneTimer = window.setTimeout(() => dispatch({ type: "fade" }), 3300);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, [status]);

  // Leaving the page (close, reload, external link) with unsaved edits asks first.
  const unsaved = status === "dirty" || status === "error" || status === "saving";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const actions = (where: "header" | "footer") => (
    <SaveActions status={status} fading={fading} loading={reddit.isLoading} onSave={() => void save()} onDiscard={discard} where={where} />
  );
  const busy = reddit.isLoading || status === "saving";

  return (
    <div className="min-w-0 max-w-3xl">
      <SettingsPageHeader title="Agents" caption="Where the Reddit agent looks for threads." actions={actions("header")} />

      <div className={`${CARD} p-5`}>
        <div className="mb-5 flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ff4500] text-white">
            <SiReddit size={21} color="#ffffff" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-ui-text">Reddit</h2>
            <p className="text-[13px] text-ui-muted">Region, subreddits and keywords for the next run.</p>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <label htmlFor="reddit-region" className="mb-1.5 block text-[13px] font-medium text-ui-text">
              Search region
            </label>
            <select
              id="reddit-region"
              value={current.country}
              onChange={(e) => edit({ country: e.target.value === "us" ? "us" : "global" })}
              disabled={busy}
              className={INPUT}
            >
              <option value="global">Global (no filter)</option>
              <option value="us">United States only</option>
            </select>
          </div>
          <ChipField
            id="reddit-subreddits"
            label="Priority subreddits"
            max={REDDIT_LIMITS.subreddits}
            items={current.subreddits}
            placeholder="Add a subreddit, like r/startups, and press Enter"
            disabled={status === "saving"}
            loading={reddit.isLoading}
            add={addSubreddit}
            onChange={(subreddits) => edit({ subreddits })}
          />
          <ChipField
            id="reddit-keywords"
            label="Search keywords"
            max={REDDIT_LIMITS.keywords}
            items={current.keywords}
            placeholder="Add a keyword and press Enter"
            disabled={status === "saving"}
            loading={reddit.isLoading}
            add={addKeyword}
            onChange={(keywords) => edit({ keywords })}
          />
        </div>

        {reddit.isError && <p className="mt-4 text-xs text-ui-danger-text">Could not load your saved Reddit settings. Refresh to try again.</p>}
        <p className="mt-5 border-t border-ui-border pt-4 text-xs text-ui-subtle">
          Priority subreddits, keywords and region apply to your next Reddit run.
        </p>

        <div className="mt-4 border-t border-ui-border pt-4 sm:hidden">{actions("footer")}</div>
      </div>
    </div>
  );
}
