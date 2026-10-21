"use client";

import { useEffect, useState } from "react";
import { Globe, Save, Loader2, X } from "lucide-react";
import Toggle from "@/components/settings/Toggle";
import { useToast } from "@/components/dashboard/Toast";
import { SkeletonLine } from "@/components/shared/Skeleton";
import { useRedditSettings } from "@/components/settings/useRedditSettings";
import { addKeyword, addSubreddit, REDDIT_LIMITS, type AddResult, type RedditSettings } from "@/lib/domain/reddit/redditSettings";

type AgentToggleState = Record<string, boolean>;

const PLATFORM_AGENTS = [
  { id: "x", name: "X / Twitter", desc: "The tone and voice for posts on X.", iconBg: "#111111", icon: "𝕏" },
  { id: "linkedin", name: "LinkedIn", desc: "The tone and voice for LinkedIn posts.", iconBg: "#0a66c2", icon: "in" },
  { id: "articles", name: "Articles", desc: "How the agent writes long-form content.", iconBg: "#8b5cf6", icon: "📝" },
];

const TOGGLE_IDS = ["seo", "reddit", "x", "linkedin", "articles"];

const SETTINGS_KEYS = {
  region: "agents_region",
  redditPrompt: "agents_reddit_prompt",
  toggle: (id: string) => `agents_toggle_${id}`,
};

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
        <span className="text-gray-400">
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
                    className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50"
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
        <p role="alert" className="mt-1 text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export default function AgentsSettingsPage() {
  const { show } = useToast();
  const [toggles, setToggles] = useState<AgentToggleState>({
    seo: true,
    reddit: true,
    x: true,
    linkedin: true,
    articles: true,
  });
  const [region, setRegion] = useState("United States (English)");
  const [redditPrompt, setRedditPrompt] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
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

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const find = (key: string) => data.settings?.find((s: { key: string; value: string }) => s.key === key)?.value;
        setToggles((t) => {
          const next = { ...t };
          for (const id of TOGGLE_IDS) {
            const v = find(SETTINGS_KEYS.toggle(id));
            if (v !== undefined) next[id] = v === "true";
          }
          return next;
        });
        setRegion(find(SETTINGS_KEYS.region) ?? "United States (English)");
        setRedditPrompt(find(SETTINGS_KEYS.redditPrompt) ?? "");
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  function setToggle(id: string, v: boolean) {
    setToggles((t) => ({ ...t, [id]: v }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const entries: [string, string][] = [
        ...TOGGLE_IDS.map((id): [string, string] => [SETTINGS_KEYS.toggle(id), String(toggles[id])]),
        [SETTINGS_KEYS.region, region],
        [SETTINGS_KEYS.redditPrompt, redditPrompt],
      ];
      for (const [key, value] of entries) {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save");
      }
      show("Settings saved.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 max-w-3xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-semibold text-gray-900">Agents</h1>
          <p className="text-[13px] text-gray-500">Platform instructions, toggles, and brand voice.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !loaded}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-[13px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-blue-500" />
            <div>
              <div className="text-[13px] font-semibold text-gray-900">SEO Analysis</div>
              <div className="text-[12px] text-gray-500">The market your search and AI-visibility data is tracked for.</div>
            </div>
          </div>
          <Toggle checked={toggles.seo} onChange={(v) => setToggle("seo", v)} />
        </div>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          disabled={!toggles.seo}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 disabled:opacity-50"
        >
          <option>United States (English)</option>
          <option>United Kingdom (English)</option>
          <option>India (English)</option>
          <option>Germany (German)</option>
        </select>
        <p className="mt-2 text-[11px] text-gray-400">
          Applies on the next run. Past data from other markets is kept; ChatGPT data stays US-only.
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff4500] text-[11px] text-white">
              🤖
            </span>
            <div>
              <div className="text-[13px] font-semibold text-gray-900">Reddit</div>
              <div className="text-[12px] text-gray-500">How replies should read, and where the agent looks.</div>
            </div>
          </div>
          <Toggle checked={toggles.reddit} onChange={(v) => setToggle("reddit", v)} />
        </div>
        <textarea
          value={redditPrompt}
          onChange={(e) => setRedditPrompt(e.target.value)}
          disabled={!toggles.reddit}
          placeholder="Sound like a helpful user, keep replies concise, avoid over-promotional language…"
          className="mb-3 h-24 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 disabled:opacity-50"
        />
        <label className="mb-1 flex items-center gap-1 text-[12px] text-gray-600">Search region</label>
        <select
          value={reddit.settings.country}
          onChange={async (e) => {
            const failure = await saveReddit({ country: e.target.value === "us" ? "us" : "global" });
            if (failure) show(failure);
          }}
          disabled={!toggles.reddit || reddit.isLoading || reddit.save.isPending}
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
            disabled={!toggles.reddit}
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
          disabled={!toggles.reddit}
          loading={reddit.isLoading}
          add={addKeyword}
          onChange={(keywords) => saveReddit({ keywords })}
        />
        {reddit.isError && <p className="mt-2 text-[11px] text-red-600">Could not load your saved Reddit settings. Refresh to try again.</p>}
        <p className="mt-2 text-[11px] text-gray-400">Priority subreddits, keywords and region save as you change them and focus the next Reddit run.</p>
      </div>

      {PLATFORM_AGENTS.filter((a) => a.id !== "articles").map((agent) => (
        <div key={agent.id} className="mb-4 rounded-xl border border-gray-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: agent.iconBg }}
              >
                {agent.icon}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-gray-900">{agent.name}</div>
                <div className="text-[12px] text-gray-500">{agent.desc}</div>
              </div>
            </div>
            <Toggle checked={toggles[agent.id]} onChange={(v) => setToggle(agent.id, v)} />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
            <div>
              <div className="text-[12px] text-gray-600">Brand voice</div>
              <div className="text-[11px] text-gray-400">Used when the agent writes for this platform.</div>
            </div>
            <div className="flex items-center gap-3 text-[12px]">
              <button onClick={() => show("Write your own — coming soon.")} className="text-gray-600 hover:text-gray-900">
                Write your own
              </button>
              <button
                onClick={() => show(`Setting up your ${agent.name} brand voice...`)}
                className="text-gray-600 hover:text-gray-900"
              >
                ✨ Set up my {agent.name} brand voice
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
