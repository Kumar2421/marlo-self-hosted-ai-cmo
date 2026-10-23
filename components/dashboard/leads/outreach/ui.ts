import { FOCUS_RING } from "@/components/ui/variants";

/** Button and field classes shared by the outreach flow. 44px tall below sm, 36px above. */
const BTN = `${FOCUS_RING} inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 sm:h-9`;

export const BTN_PRIMARY = `${BTN} bg-ui-primary text-ui-inverse hover:bg-ui-primary-hover`;
export const BTN_SECONDARY = `${BTN} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50`;
export const BTN_GHOST = `${BTN} text-gray-600 hover:bg-gray-100`;

export const FIELD = `${FOCUS_RING} w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-800 placeholder:text-gray-400`;
export const LABEL = "mb-1 block text-xs font-medium text-gray-700";

export type LeadLite = { id: string; name: string; company: string; title: string; email: string | null };

export function leadLabel(lead: Pick<LeadLite, "name" | "company"> | undefined): string {
  return lead?.name?.trim() || lead?.company?.trim() || "Unnamed lead";
}
