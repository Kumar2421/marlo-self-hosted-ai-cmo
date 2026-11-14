/**
 * What the first-run dialog asks. Someone who arrives from the free audit has already given their website and
 * has just seen a result, so the dialog asks only for the site (prefilled) and records where they came from,
 * instead of two questions that have nothing to do with getting value.
 */

export const AUDIT_SOURCE_LABEL = "Free audit page";

export type OnboardingFields = {
  askSource: boolean;
  askRole: boolean;
  /** Saved as onboarding_source when the questions are skipped. */
  impliedSource: string | null;
  /** The site to prefill, already trimmed. */
  prefillUrl: string;
};

export function onboardingFields(pendingAuditUrl: string | null | undefined): OnboardingFields {
  const prefillUrl = (pendingAuditUrl ?? "").trim();
  if (!prefillUrl) return { askSource: true, askRole: true, impliedSource: null, prefillUrl: "" };
  return { askSource: false, askRole: false, impliedSource: AUDIT_SOURCE_LABEL, prefillUrl };
}
