"use client";

import { useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { getPlatformConfig, listPlatforms } from "@/lib/domain/social/platforms";
import { useSocialDraftList, useSocialDraftActions, type SocialPlatform } from "./useSocialDrafts";
import SocialWriterPanel from "./SocialWriterPanel";
import SocialNavMenu from "./SocialNavMenu";

function PlatformIcon({ platform }: { platform: SocialPlatform }) {
  if (platform === "x") {
    return (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" className="text-gray-700">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }
  if (platform === "linkedin") {
    return (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" className="text-blue-700">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    );
  }
  if (platform === "reddit") {
    return (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" className="text-orange-600">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.385 4.859-7.181 4.859-3.796 0-7.182-2.165-7.182-4.859a3.5 3.5 0 0 1 .476-1.566c-.51-.3-.923-.926-.923-1.653 0-.968.786-1.754 1.754-1.754.418 0 .803.13 1.122.333 1.242-.863 2.857-1.39 4.555-1.454l.922-4.31a1.286 1.286 0 0 1 1.579-1.041l2.915.567a1.25 1.25 0 1 1-.123 2.496l-2.457-.503-.565 2.663zM9.25 12a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0zm5.5 0a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0z" />
      </svg>
    );
  }
  return null;
}

function PlatformCard({ platform, onOpen }: { platform: SocialPlatform; onOpen: () => void }) {
  const config = getPlatformConfig(platform);
  const currentList = useSocialDraftList(platform, "current", true);
  const archivedList = useSocialDraftList(platform, "archived", true);
  const { generate } = useSocialDraftActions(platform);

  const currentCount = currentList.data?.length ?? 0;
  const archivedCount = archivedList.data?.length ?? 0;
  const loading = currentList.isPending || archivedList.isPending;
  const error = currentList.isError || archivedList.isError;

  let latestDraft = currentList.data?.[0];
  if (!latestDraft && archivedList.data) {
    latestDraft = archivedList.data[0];
  }

  const getPreview = () => {
    if (!latestDraft) return "No drafts yet";
    if (platform === "x" && "text" in latestDraft) {
      return latestDraft.text.split("\n")[0]?.slice(0, 60) || "No text";
    }
    if (platform === "linkedin" && "hookLine" in latestDraft) {
      return latestDraft.hookLine.slice(0, 60);
    }
    if (platform === "reddit" && "title" in latestDraft) {
      return latestDraft.title.slice(0, 60);
    }
    return "No preview";
  };

  const getErrorMsg = () => {
    if (currentList.isError) return currentList.error instanceof Error ? currentList.error.message : "Couldn't load drafts";
    if (archivedList.isError) return archivedList.error instanceof Error ? archivedList.error.message : "Couldn't load drafts";
    return "Couldn't load drafts";
  };

  const handleRetry = () => {
    currentList.refetch();
    archivedList.refetch();
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <PlatformIcon platform={platform} />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-gray-900">{config.name}</h3>
            <p className="text-[11px] text-gray-500">Drafts only – you post it</p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-800">
          <span className="flex-1 line-clamp-2">{getErrorMsg()}</span>
          <button
            type="button"
            onClick={handleRetry}
            className="shrink-0 whitespace-nowrap font-medium underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-4 text-[12px] text-gray-600">
            <span>{currentCount} current</span>
            <span>{archivedCount} archived</span>
          </div>

          {loading ? (
            <div className="mb-3 h-12 rounded-lg bg-gray-50 animate-pulse" />
          ) : latestDraft ? (
            <div className="mb-3 rounded-lg bg-gray-50 p-2.5 text-[12px] leading-relaxed text-gray-700">
              <p className="line-clamp-2">{getPreview()}</p>
            </div>
          ) : (
            <div className="mb-3 rounded-lg bg-gray-50 p-2.5 text-[12px] text-gray-500">No drafts yet</div>
          )}
        </>
      )}

      <div className="flex gap-2">
        <button
          onClick={onOpen}
          disabled={generate.isPending || error}
          className="flex-1 rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {generate.isPending ? <Loader2 size={12} className="inline animate-spin mr-1" /> : "Draft posts"}
        </button>
        {currentCount > 0 && !error && (
          <button
            onClick={onOpen}
            className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
          >
            Open drafts
          </button>
        )}
      </div>
    </div>
  );
}

export default function SocialTab() {
  const [openPlatform, setOpenPlatform] = useState<SocialPlatform | null>(null);
  const platforms = listPlatforms();

  if (openPlatform) {
    return <SocialWriterPanel platform={openPlatform} onClose={() => setOpenPlatform(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="mb-4 flex items-center gap-2">
        <MessageCircle size={16} className="text-gray-700" />
        <h3 className="text-[13px] font-semibold text-gray-900">Social Post Drafts</h3>
      </div>

      <SocialNavMenu />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {platforms.map((platform) => (
          <PlatformCard key={platform.id} platform={platform.id} onOpen={() => setOpenPlatform(platform.id)} />
        ))}
      </div>
    </div>
  );
}
