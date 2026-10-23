"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import SidePanel from "@/components/shared/SidePanel";
import {
  COMPANY_SIZES, describeProfile, emptyProfile, LIMITS, normalizeProfile, profileProblems, type CompanySize, type LeadProfile,
} from "@/lib/domain/leads/leadProfile";
import ChipInput from "./ChipInput";

const ROLE_SUGGESTIONS = ["Founder", "CEO", "CTO", "CMO", "Head of Marketing", "Head of Growth", "VP Sales", "Marketing Manager", "Product Manager", "Operations Manager"];
const INDUSTRY_SUGGESTIONS = ["SaaS", "E-commerce", "Marketing agencies", "Fintech", "Healthcare", "Education", "Real estate", "Manufacturing", "Logistics", "Consulting"];
const LOCATION_SUGGESTIONS = ["United States", "India", "United Kingdom", "Europe", "Remote"];

const STEPS = ["Who to reach", "Their companies", "Your offer", "Review"] as const;

function Field({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
      {hint && <p className="mb-2 mt-0.5 text-[12px] leading-4 text-gray-500">{hint}</p>}
      {children}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-gray-100 px-3 py-2.5 first:border-t-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-ui-subtle">{label}</div>
      <div className="mt-0.5 text-[13px] text-gray-800">{value || "—"}</div>
    </div>
  );
}

/**
 * Guided lead profile. The user confirms who they want to reach once; every
 * search and the daily leads then start from it, so leads fit the product
 * instead of just matching a job title.
 */
export default function LeadProfileWizard({
  open,
  onClose,
  initial,
  saving,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  initial: LeadProfile | null;
  saving: boolean;
  error: string | null;
  onConfirm: (profile: LeadProfile) => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<LeadProfile>(() => initial ?? emptyProfile());
  const update = (patch: Partial<LeadProfile>) => setDraft((current) => ({ ...current, ...patch }));

  const clean = normalizeProfile(draft);
  const problems = profileProblems(clean);
  const canNext = step === 0 ? clean.roles.length > 0 : step === 1 ? clean.industries.length > 0 : true;
  const last = step === STEPS.length - 1;

  const toggleSize = (size: CompanySize) =>
    update({ sizes: draft.sizes.includes(size) ? draft.sizes.filter((s) => s !== size) : [...draft.sizes, size] });

  const progress = (
    <ol className="flex items-center gap-1.5" aria-label="Setup progress">
      {STEPS.map((name, index) => (
        <li key={name} className="flex items-center gap-1.5">
          <span
            aria-current={index === step ? "step" : undefined}
            className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
              index < step ? "bg-emerald-100 text-emerald-700" : index === step ? "bg-gray-900 text-white" : "bg-gray-100 text-ui-subtle"
            }`}
          >
            {index < step ? <Check size={11} /> : index + 1}
          </span>
          <span className={`hidden text-xs sm:inline ${index === step ? "font-medium text-gray-900" : "text-ui-subtle"}`}>{name}</span>
          {index < STEPS.length - 1 && <span className="h-px w-3 bg-gray-200" />}
        </li>
      ))}
    </ol>
  );

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
        className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
      >
        {step === 0 ? "Cancel" : "Back"}
      </button>
      {last ? (
        <button
          type="button"
          disabled={saving || problems.length > 0}
          onClick={() => onConfirm(clean)}
          className="rounded-lg bg-gray-900 px-4 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {saving ? "Saving…" : "Confirm and find leads"}
        </button>
      ) : (
        <button
          type="button"
          disabled={!canNext}
          onClick={() => setStep(step + 1)}
          className="rounded-lg bg-gray-900 px-4 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50"
        >
          Next
        </button>
      )}
    </div>
  );

  return (
    <SidePanel open={open} onClose={onClose} width="md" title="Set up your lead profile" subtitle={`Step ${step + 1} of ${STEPS.length}`} toolbar={progress} footer={footer}>
      {step === 0 && (
        <Field title="Who do you want to reach?" hint="The job titles of the people who decide to buy what you sell.">
          <ChipInput label="Job titles" value={draft.roles} onChange={(roles) => update({ roles })} suggestions={ROLE_SUGGESTIONS} placeholder="e.g. Head of Marketing" max={LIMITS.roles} />
        </Field>
      )}

      {step === 1 && (
        <>
          <Field title="What kind of companies do they work at?" hint="The industries or types of company you sell to.">
            <ChipInput label="Company types" value={draft.industries} onChange={(industries) => update({ industries })} suggestions={INDUSTRY_SUGGESTIONS} placeholder="e.g. SaaS" max={LIMITS.industries} />
          </Field>
          <Field title="How big?" hint="Optional. Pick all that fit.">
            <div className="flex flex-wrap gap-1.5">
              {COMPANY_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={draft.sizes.includes(size)}
                  onClick={() => toggleSize(size)}
                  className={`rounded-full border px-3 py-1 text-[12px] ${
                    draft.sizes.includes(size) ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {size} people
                </button>
              ))}
            </div>
          </Field>
          <Field title="Where?" hint="Optional. Leave empty to search anywhere.">
            <ChipInput label="Locations" value={draft.locations} onChange={(locations) => update({ locations })} suggestions={LOCATION_SUGGESTIONS} placeholder="e.g. India" max={LIMITS.locations} />
          </Field>
        </>
      )}

      {step === 2 && (
        <>
          <Field title="What problem do you solve for them?" hint="One or two sentences. It helps pick people who actually need this, and later shapes your outreach.">
            <textarea
              value={draft.problem}
              onChange={(e) => update({ problem: e.target.value.slice(0, LIMITS.problemLength) })}
              rows={4}
              placeholder="e.g. Small shops lose sales because their website is slow and hard to find on Google."
              className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[12px] text-gray-800 placeholder:text-gray-400"
            />
            <div className="mt-1 text-right text-xs text-ui-subtle">{draft.problem.length}/{LIMITS.problemLength}</div>
          </Field>
          <Field title="Who should we never show you?" hint="Competitors and companies to skip. Your competitors are added for you.">
            <ChipInput label="Excluded companies" value={draft.exclude} onChange={(exclude) => update({ exclude })} placeholder="e.g. rival.com" max={LIMITS.exclude} />
          </Field>
          <Field title="Does your product help with websites or marketing?">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 p-3">
              <input type="checkbox" checked={draft.webRelated} onChange={(e) => update({ webRelated: e.target.checked })} className="mt-0.5" />
              <span className="text-[12px] leading-4 text-gray-700">
                Yes. Check each lead&apos;s website so your outreach can mention a real issue (missing titles, slow pages, and so on).
              </span>
            </label>
          </Field>
        </>
      )}

      {step === 3 && (
        <>
          <p className="mb-3 text-[12px] leading-5 text-gray-600">
            Here is who we will look for: <strong className="text-gray-900">{describeProfile(clean) || "—"}</strong>.
          </p>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <Summary label="Job titles" value={clean.roles.join(", ")} />
            <Summary label="Company types" value={clean.industries.join(", ")} />
            <Summary label="Company size" value={clean.sizes.length ? clean.sizes.map((s) => `${s} people`).join(", ") : "Any"} />
            <Summary label="Locations" value={clean.locations.length ? clean.locations.join(", ") : "Anywhere"} />
            <Summary label="Problem you solve" value={clean.problem} />
            <Summary label="Never show" value={clean.exclude.join(", ")} />
            <Summary label="Check lead websites" value={clean.webRelated ? "Yes" : "No"} />
          </div>
          {problems.length > 0 && <p className="mt-3 text-[12px] text-red-600">{problems[0]}</p>}
          {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
          <p className="mt-3 text-xs text-gray-500">You can change this any time from the Leads tab. Daily leads start once it is confirmed.</p>
        </>
      )}
    </SidePanel>
  );
}
