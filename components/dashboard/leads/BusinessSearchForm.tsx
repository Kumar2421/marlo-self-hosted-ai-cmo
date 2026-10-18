"use client";

import { Building2, Loader2 } from "lucide-react";

const INPUT = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400";

/** Category and location for a local places search. Values are controlled by the panel. */
export default function BusinessSearchForm({
  category,
  location,
  onCategoryChange,
  onLocationChange,
  fromProfile,
  hasProfile,
  onEditProfile,
  searching,
  disabled,
  onSearch,
  showKeyHint,
}: {
  category: string;
  location: string;
  onCategoryChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  /** True when the shown category or location is still the one suggested by the lead profile. */
  fromProfile: boolean;
  hasProfile: boolean;
  onEditProfile: () => void;
  searching: boolean;
  disabled: boolean;
  onSearch: () => void;
  /** Self-host only: the search needs the user's own Google Cloud key. */
  showKeyHint: boolean;
}) {
  return (
    <>
      <input
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSearch()}
        placeholder="Category - e.g. dentist, gym, coffee shop"
        aria-label="Category"
        className={INPUT}
      />
      <input
        value={location}
        onChange={(e) => onLocationChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSearch()}
        placeholder="Location - e.g. Austin, TX"
        aria-label="Location"
        className={INPUT}
      />

      {hasProfile && fromProfile && (
        <p className="text-[11px] text-gray-500">
          From your lead profile ·{" "}
          <button type="button" onClick={onEditProfile} className="text-gray-700 underline hover:text-gray-900">
            Edit profile
          </button>
        </p>
      )}

      <button
        type="button"
        onClick={onSearch}
        disabled={searching || disabled}
        className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[#111111] py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
      >
        {searching ? <Loader2 size={13} className="animate-spin" /> : <Building2 size={13} />}
        {searching ? "Searching..." : "Search places"}
      </button>

      {showKeyHint && (
        <p className="text-[11px] text-amber-600">
          ⚠ No Google Cloud key connected -{" "}
          <a href="/settings/api-credentials" className="underline hover:text-amber-700">
            connect one in Settings
          </a>{" "}
          (with Places API enabled) to search real businesses.
        </p>
      )}
      {!showKeyHint && <p className="text-[11px] text-gray-400">Real places from Google Maps, with their own websites checked.</p>}
    </>
  );
}
