"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { getPlatformConfig, type PlatformId } from "@/lib/domain/social/platforms";
import {
  SOCIAL_NAV_PLATFORMS,
  countDraftsToReview,
  formatDraftsToReview,
  hasUnreviewedDrafts,
} from "@/lib/domain/social/socialNav";
import { useClickOutside } from "../useClickOutside";
import { useSocialDraftList } from "./useSocialDrafts";
import { useSocialPanel } from "./SocialPanelProvider";
import PlatformIcon from "./PlatformIcon";

/** Draft counts may be a minute old: the menu never polls. */
const COUNT_STALE_MS = 60_000;

/**
 * Top-bar "Social" dropdown. Lists each network with how many drafts wait for review,
 * and opens that network's side panel. One combined dot on the button shows when any
 * network has a draft to review; the counts reuse the same cached lists, so opening
 * the menu does not add requests.
 */
export default function SocialNavMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusOnOpen = useRef<number | null>(null);
  const menuId = useId();
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

  // Keyboard users arrive on a specific item; move focus once the menu has rendered.
  useEffect(() => {
    if (!open || focusOnOpen.current === null) return;
    itemRefs.current[focusOnOpen.current]?.focus();
    focusOnOpen.current = null;
  }, [open]);

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
      setOpen(false);
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
      setOpen(false);
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
        className="relative flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-gray-400 hover:bg-white/10 hover:text-white"
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
          role="menu"
          aria-label="Social drafts"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-10 z-50 w-64 max-w-[calc(100vw-24px)] rounded-xl border border-gray-200 bg-white p-2 text-gray-900 shadow-xl"
        >
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
      )}
    </div>
  );
}
