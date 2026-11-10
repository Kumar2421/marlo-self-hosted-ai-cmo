"use client";

import { useState } from "react";
import { Building2, ChevronDown, Loader2, Search, Target } from "lucide-react";
import { describeProfile, type LeadProfile, type LeadSearchTarget } from "@/lib/domain/leads/leadProfile";

function Pick({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  if (options.length === 0) return null;
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-ui-subtle">{label}</span>
      {options.length === 1 ? (
        <span className="block rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-[12px] text-gray-800">{options[0]}</span>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-800"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

/** The confirmed profile in one line, with a one-click search built from it. */
export default function LeadProfileSearch({
  profile,
  searching,
  disabled,
  onEdit,
  onSearch,
  onSearchCompanies,
  collapsed = false,
  summary,
  onToggle,
}: {
  profile: LeadProfile;
  searching: boolean;
  disabled: boolean;
  onEdit: () => void;
  onSearch: (target: LeadSearchTarget) => void;
  /** Finds company websites that match the profile and keeps the ones with a contact. */
  onSearchCompanies?: () => void;
  /** One-line mode: a summary plus the Find leads button. The picks below keep their values. */
  collapsed?: boolean;
  summary?: string;
  onToggle?: () => void;
}) {
  const [role, setRole] = useState(profile.roles[0] ?? "");
  const [industry, setIndustry] = useState(profile.industries[0] ?? "");
  const [location, setLocation] = useState(profile.locations[0] ?? "");

  const search = () => onSearch({ role, companyOrIndustry: industry, location });
  // A profile with no job titles sells to businesses in general: companies are the search, people need a role.
  const canSearchCompanies = Boolean(onSearchCompanies) && profile.industries.length > 0;
  const canSearchPeople = profile.roles.length > 0 || !canSearchCompanies;
  const companiesPrimary = !canSearchPeople;
  // Two buttons do not fit beside the summary in the narrowest panel, so they take their own row under it.
  const bothButtons = canSearchCompanies && canSearchPeople;

  if (collapsed) {
    return (
      <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-2.5 py-1" data-testid="lead-profile-summary">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          title="Show the lead profile"
          className={`flex min-h-9 min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] text-gray-700 ${bothButtons ? "basis-full" : ""}`}
        >
          <Target size={13} className="shrink-0 text-ui-faint" />
          <span className="min-w-0 line-clamp-2 break-words font-medium leading-4 text-gray-900">
            {summary ?? describeProfile(profile)}
            <span className="font-normal text-ui-subtle"> · </span>
            <span className="font-normal text-gray-500 hover:text-gray-900 hover:underline">Edit</span>
          </span>
        </button>
        {canSearchCompanies && (
          <button
            type="button"
            onClick={onSearchCompanies}
            disabled={searching || disabled}
            className={`flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-medium disabled:opacity-50 ${bothButtons ? "flex-1" : "shrink-0"} ${
              companiesPrimary ? "bg-[#111111] text-white hover:bg-black" : "border border-gray-200 text-gray-800 hover:bg-gray-50"
            }`}
          >
            {searching && companiesPrimary ? <Loader2 size={12} className="animate-spin" /> : <Building2 size={12} />}
            {searching && companiesPrimary ? "Searching..." : "Find companies"}
          </button>
        )}
        {canSearchPeople && (
          <button
            type="button"
            onClick={search}
            disabled={searching || disabled}
            className={`flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-[#111111] px-3 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50 ${bothButtons ? "flex-1" : "shrink-0"}`}
          >
            {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            {searching ? "Searching..." : "Find leads"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Target size={14} className="mt-0.5 shrink-0 text-ui-faint" />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-gray-900">Your lead profile</div>
            <p className="mt-0.5 text-xs leading-4 text-gray-500">{describeProfile(profile)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onEdit} className="text-xs font-medium text-gray-500 hover:text-gray-900 hover:underline">
            Edit
          </button>
          {onToggle && (
            <button type="button" onClick={onToggle} aria-expanded title="Collapse" className="flex h-7 w-7 items-center justify-center text-ui-subtle hover:text-gray-700">
              <ChevronDown size={14} className="rotate-180" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Pick label="Job title" options={profile.roles} value={role} onChange={setRole} />
        <Pick label="Company type" options={profile.industries} value={industry} onChange={setIndustry} />
        <Pick label="Location" options={profile.locations} value={location} onChange={setLocation} />
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {canSearchCompanies && (
          <button
            type="button"
            onClick={onSearchCompanies}
            disabled={searching || disabled}
            className={`flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px] font-medium disabled:opacity-50 ${
              companiesPrimary ? "bg-[#111111] text-white hover:bg-black" : "border border-gray-200 text-gray-800 hover:bg-gray-50"
            }`}
          >
            {searching && companiesPrimary ? <Loader2 size={13} className="animate-spin" /> : <Building2 size={13} />}
            {searching && companiesPrimary ? "Searching..." : "Find companies"}
          </button>
        )}
        {canSearchPeople && (
          <button
            type="button"
            onClick={search}
            disabled={searching || disabled}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#111111] py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            {searching ? "Searching..." : "Find leads"}
          </button>
        )}
      </div>
    </div>
  );
}
