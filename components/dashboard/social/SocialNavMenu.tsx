"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MessageCircle } from "lucide-react";
import { getPlatformConfig, type PlatformId } from "@/lib/domain/social/platforms";
import {
  SOCIAL_NAV_PLATFORMS,
  countDraftsToReview,
  formatDraftsToReview,
  hasUnreviewedDrafts,
} from "@/lib/domain/social/socialNav";
import type { DailyDraftSettings } from "@/lib/domain/social/dailyDraftSettings";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import { useClickOutside } from "../useClickOutside";
import { useSocialDraftList } from "./useSocialDrafts";
import { useSocialPanel } from "./SocialPanelProvider";
import PlatformIcon from "./PlatformIcon";

/** Draft counts may be a minute old: the menu never polls. */
const COUNT_STALE_MS = 60_000;

const DAILY_ENDPOINT = "/api/agents/social/daily-settings";
const JSON_HEADERS = { "Content-Type": "application/json" };

const DAILY_NETWORKS: Array<{ id: PlatformId; name: string }> = [
  { id: "x", name: "X" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "reddit", name: "Reddit" },
];

/**
 * The project's daily draft switches. Fetched only while the menu is open.
 * Saves are optimistic and roll back when the server refuses.
 */
export function useDailyDraftSettings(enabled: boolean) {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const key = qk.socialDailySettings(project?.id);

  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await fetchJson<{ settings: DailyDraftSettings }>(DAILY_ENDPOINT)).settings,
    enabled: Boolean(project) && enabled,
  });

  const save = useMutation({
    mutationFn: (settings: DailyDraftSettings) =>
      fetchJson<{ settings: DailyDraftSettings }>(DAILY_ENDPOINT, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ settings }),
      }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DailyDraftSettings>(key);
      queryClient.setQueryData<DailyDraftSettings>(key, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      queryClient.setQueryData<DailyDraftSettings>(key, context?.previous);
    },
    onSuccess: (data) => {
      queryClient.setQueryData<DailyDraftSettings>(key, data.settings);
    },
  });

  return { query, save };
}

/**
 * Top-bar "Social" dropdown. Lists each network with how many drafts wait for review,
 * and opens that network's side panel. One combined dot on the button shows when any
 * network has a draft to review; the counts reuse the same cached lists, so opening
 * the menu does not add requests. Below the networks sits the "Daily drafts" section:
 * one switch per network for the automatic daily draft.
 */
export default function SocialNavMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusOnOpen = useRef<number | null>(null);
  const menuId = useId();
  const dailyHeadingId = useId();
  const social = useSocialPanel();

  const closeMenu = useCallback(() => setOpen(false), []);
  const wrapRef = useClickOutside<HTMLDivElement>(closeMenu);

  const xList = useSocialDraftList("x", "current", true, COUNT_STALE_MS);
  const linkedinList = useSocialDraftList("linkedin", "current", true, COUNT_STALE_MS);
  const redditList = useSocialDraftList("reddit", "current", true, COUNT_STALE_MS);
  const lists: Record<PlatformId, typeof xList> = { x: xList, linkedin: linkedinList, reddit: redditList };

  const counts: Partial<Record<PlatformId, number>> = {
    x: countDraftsToReview(xList.data),
    linkedin: countDraftsToReview(linkedinList.data),
    reddit: countDraftsToReview(redditList.data),
  };
  const anyUnreviewed = hasUnreviewedDrafts(counts);

  const daily = useDailyDraftSettings(open);
  const dailySettings = daily.query.data;

  // Keyboard users arrive on a specific item; move focus once the menu has rendered.
  useEffect(() => {
    if (!open || focusOnOpen.current === null) return;
    itemRefs.current[focusOnOpen.current]?.focus();
    focusOnOpen.current = null;
  }, [open]);

  // Tab can move focus into the daily switches, so the menu closes only once focus has
  // really left it (checked after the browser has moved focus).
  function closeIfFocusLeft() {
    setTimeout(() => {
      if (wrapRef.current && !wrapRef.current.contains(document.activeElement)) setOpen(false);
    }, 0);
  }

  function choose(platform: PlatformId) {
    setOpen(false);
    social.open(platform);
  }

  function moveFocus(from: number, step: number) {
    const count = SOCIAL_NAV_PLATFORMS.length;
    const next = (from + step + count) % count;
    itemRefs.current[next]?.focus();
  }

  function onButtonKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab" && open) {
      closeIfFocusLeft();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
      e.preventDefault();
      focusOnOpen.current = e.key === "ArrowDown" ? 0 : SOCIAL_NAV_PLATFORMS.length - 1;
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = itemRefs.current.indexOf(e.target as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "Tab") {
      closeIfFocusLeft();
    } else if (index < 0) {
      // Focus is on a daily switch: arrows and Home/End are left to the browser.
      return;
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(index, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(index, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      itemRefs.current[SOCIAL_NAV_PLATFORMS.length - 1]?.focus();
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          // e.detail is 0 for keyboard-triggered clicks: then move focus into the menu.
          if (!open && e.detail === 0) focusOnOpen.current = 0;
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKeyDown}
        aria-label="Social drafts"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Social drafts"
        className="relative flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-gray-400 hover:bg-white/10 hover:text-white md:h-8 md:min-w-0 md:justify-start"
      >
        <MessageCircle size={16} aria-hidden="true" />
        <span className="hidden md:inline">Social</span>
        <ChevronDown size={12} aria-hidden="true" className={`hidden opacity-60 transition-transform md:block ${open ? "rotate-180" : ""}`} />
        {anyUnreviewed && (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[#00ab92] ring-2 ring-[#110f0e]"
          />
        )}
      </button>

      {open && (
        <div
          id={menuId}
          onKeyDown={onMenuKeyDown}
          className="theme-follow absolute right-0 top-10 z-50 w-64 max-w-[calc(100vw-24px)] rounded-xl border border-gray-200 bg-white p-2 text-gray-900 shadow-xl"
        >
          <div role="menu" aria-label="Social drafts">
            {SOCIAL_NAV_PLATFORMS.map((platform, index) => {
              const list = lists[platform];
              const loading = list.isPending && list.fetchStatus === "fetching";
              const subtitle = list.isError
                ? "Couldn't load drafts"
                : loading
                  ? "Checking drafts..."
                  : formatDraftsToReview(counts[platform] ?? 0);
              return (
                <button
                  key={platform}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => choose(platform)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                    <PlatformIcon platform={platform} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-gray-900">{getPlatformConfig(platform).name}</span>
                    <span className="block text-[12px] text-gray-500">{subtitle}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div role="separator" className="my-2 border-t border-gray-100" />

          <section aria-labelledby={dailyHeadingId} className="px-2.5 pb-1">
            <h4 id={dailyHeadingId} className="text-[12px] font-medium text-gray-900">Daily drafts</h4>
            <p className="mb-2 text-xs text-gray-500">One draft per network each day, for review. Nothing is posted.</p>

            {daily.query.isError ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                <span>Could not load settings.</span>
                <button type="button" onClick={() => daily.query.refetch()} className="font-medium underline hover:no-underline">
                  Retry
                </button>
              </div>
            ) : !dailySettings ? (
              <div className="h-12 animate-pulse rounded-lg bg-gray-50" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {DAILY_NETWORKS.map((network) => {
                  const on = dailySettings[network.id];
                  return (
                    <li key={network.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-[12px] font-medium text-gray-800">{network.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Auto-draft daily</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`Auto-draft daily on ${network.name}`}
                          disabled={daily.save.isPending}
                          onClick={() => daily.save.mutate({ ...dailySettings, [network.id]: !on })}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-gray-900 focus:outline-none disabled:opacity-60 ${on ? "bg-[#00ab92]" : "bg-gray-300"}`}
                        >
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {daily.save.isError && <p className="mt-1 text-xs text-amber-700">Could not save. The switch was set back.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
