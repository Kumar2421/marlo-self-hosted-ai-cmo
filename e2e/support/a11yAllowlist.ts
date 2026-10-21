/**
 * Known, accepted accessibility violations (axe-core "serious" / "critical" only).
 *
 * e2e/a11y.spec.ts fails on any serious or critical violation that is NOT listed
 * here, so the suite is green for today's debt but blocks new violations.
 *
 * Every entry needs:
 *   rule      axe rule id (e.g. "color-contrast")
 *   selector  the axe node target, shadow/iframe hops joined with " >> "; list rows
 *             are normalised, so `:nth-child(7)` is written `:nth-child(N)`. Copy it
 *             from the "[a11y]" lines the suite prints.
 *   reason    why it is tolerated for now, with the planned fix
 *   pages     optional: only these scan labels (see the spec); omitted when the same
 *             node shows up on several pages
 *
 * Fixing a violation? Delete its entry. Entries are matched exactly, so a stale one
 * is harmless, and the spec prints it ("stale allowlist entry") so the list shrinks.
 * Never add an entry for something new just to make the suite green: fix it.
 */
export type AllowedViolation = {
  rule: string;
  selector: string;
  reason: string;
  pages?: string[];
};

const REASON = {
  CONTRAST: "Gray-400/500 text (or white on teal) below 4.5:1. Fix with the colour tightening pass: text-gray-600 or darker for body copy, 11px minimum.",
  BUTTON_NAME: "Icon-only button without an accessible name. Fix: add aria-label (and aria-hidden on the icon).",
  LABEL: "Form control without a label. Fix: aria-label, or wrap in a <label>.",
  SELECT_NAME: "<select> without a label. Fix: aria-label or an associated <label>.",
  SVG_ALT: "Brand icon rendered as role=img without a title. Fix: aria-hidden on decorative brand icons, or pass title.",
  SCROLL_FOCUS: "Scrollable region cannot be reached by keyboard. Fix: tabIndex=0 plus an aria-label on the scroll container.",
};

export const A11Y_ALLOWLIST: AllowedViolation[] = [
  // button-name (8)
  { rule: "button-name", selector: ".mb-2\\.5 > .hover\\:text-gray-700", reason: REASON.BUTTON_NAME },
  { rule: "button-name", selector: ".gap-2\\.5.group.py-2\\.5:nth-child(N) > .flex-1.min-w-0 > .gap-2.items-center.justify-between > .group-hover\\:opacity-100.opacity-0.text-gray-300", reason: REASON.BUTTON_NAME },
  { rule: "button-name", selector: ".enabled\\:hover\\:bg-gray-200", reason: REASON.BUTTON_NAME },
  { rule: "button-name", selector: ".gap-2\\.5.group.py-2\\.5:nth-child(N) > .flex-1.min-w-0 > .gap-2.items-center.justify-between > .group-hover\\:opacity-100.hover\\:text-gray-600.opacity-0", reason: REASON.BUTTON_NAME },
  { rule: "button-name", selector: ".mb-4.p-4.rounded-xl:nth-child(N) > .items-start.justify-between.mb-3 > .relative.transition-colors.w-11", reason: REASON.BUTTON_NAME, pages: ["settings-agents"] },
  { rule: "button-name", selector: ".mb-4.p-4.rounded-xl:nth-child(N) > .flex.items-start.justify-between > .relative.transition-colors.w-11", reason: REASON.BUTTON_NAME, pages: ["settings-agents"] },
  { rule: "button-name", selector: ".mb-2\\.5 > .hover\\:text-gray-700.text-gray-400", reason: REASON.BUTTON_NAME, pages: ["mobile-Context"] },
  { rule: "button-name", selector: ".relative", reason: REASON.BUTTON_NAME, pages: ["settings-api-credentials"] },
  // label (1)
  { rule: "label", selector: ".gap-2\\.5.group.py-2\\.5:nth-child(N) > input[type=\"checkbox\"]", reason: REASON.LABEL },
  // select-name (2)
  { rule: "select-name", selector: ".mb-4.p-4.rounded-xl:nth-child(N) > select", reason: REASON.SELECT_NAME, pages: ["settings-agents"] },
  { rule: "select-name", selector: "select", reason: REASON.SELECT_NAME, pages: ["settings-personalization"] },
  // svg-img-alt (7)
  { rule: "svg-img-alt", selector: ".bg-white.p-4.rounded-xl:nth-child(N) > .items-start.justify-between.mb-3 > .flex.gap-3.items-start > .font-bold.h-9.w-9 > svg", reason: REASON.SVG_ALT, pages: ["settings-integrations"] },
  { rule: "svg-img-alt", selector: ".grid.grid-cols-2.mb-8:nth-child(N) > .bg-white.p-4.rounded-xl > .items-start.justify-between.mb-3 > .flex.gap-3.items-start > .font-bold.h-9.w-9 > svg", reason: REASON.SVG_ALT, pages: ["settings-integrations"] },
  { rule: "svg-img-alt", selector: ".flex.gap-3.items-center > .font-bold.h-9.w-9 > svg", reason: REASON.SVG_ALT, pages: ["settings-integrations"] },
  { rule: "svg-img-alt", selector: ".h-9.ring-2.ring-white:nth-child(N) > svg[role=\"img\"]", reason: REASON.SVG_ALT },
  { rule: "svg-img-alt", selector: ".border.p-4.rounded-xl:nth-child(N) > .flex.gap-3.items-start > .h-9.justify-center.w-9 > svg", reason: REASON.SVG_ALT, pages: ["settings-api-credentials"] },
  { rule: "svg-img-alt", selector: ".flex.gap-3.items-center > .h-9.justify-center.w-9 > svg", reason: REASON.SVG_ALT, pages: ["settings-api-credentials"] },
  { rule: "svg-img-alt", selector: ".items-start.justify-between.mb-3 > .flex.gap-3.items-start > .h-9.justify-center.w-9 > svg", reason: REASON.SVG_ALT, pages: ["settings-api-credentials"] },
  // scrollable-region-focusable (1)
  { rule: "scrollable-region-focusable", selector: ".border-r.flex-col.min-h-0:nth-child(N) > .okara-scroll.overflow-y-auto.p-4", reason: REASON.SCROLL_FOCUS, pages: ["desktop-analytics-Technical"] },
  // color-contrast (59)
  { rule: "color-contrast", selector: ".flex-1.min-w-0.text-gray-500", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".mb-1\\.5", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".flex-1.text-left.tracking-wide", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".justify-between.mb-2.w-full > h3", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".leading-5", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".py-3", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".py-1\\.5.rounded-lg.transition-colors:nth-child(N)", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".hover\\:bg-gray-50.rounded-xl.text-left:nth-child(N) > .text-\\[10px\\].tracking-wide.uppercase", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".font-normal", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".py-1\\.5.rounded-md.text-gray-500", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: "label:nth-child(N) > .mb-0\\.5.text-\\[10px\\].tracking-wide", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".gap-2\\.5.group.py-2\\.5:nth-child(N) > .flex-1.min-w-0 > .text-\\[11px\\].text-gray-400.truncate", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".border-gray-200.border-t.px-4 > span", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".gap-1.hover\\:text-gray-700", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".h-full.justify-center.text-\\[13px\\]", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".first\\:border-t-0 > .flex-1.min-w-0 > .text-\\[11px\\].text-gray-400.truncate", reason: REASON.CONTRAST, pages: ["desktop-analytics-Links"] },
  { rule: "color-contrast", selector: "label:nth-child(N) > .mb-0\\.5.text-\\[10px\\].uppercase", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: "#terminal-log-panel > .text-gray-600", reason: REASON.CONTRAST, pages: ["desktop-log-open"] },
  { rule: "color-contrast", selector: ".font-semibold.text-left.tracking-wide", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: "p:nth-child(N)", reason: REASON.CONTRAST, pages: ["desktop-analytics-Findings"] },
  { rule: "color-contrast", selector: ".border-t.px-4.py-3", reason: REASON.CONTRAST, pages: ["desktop-analytics-Findings"] },
  { rule: "color-contrast", selector: ".bg-white.p-3.rounded-xl:nth-child(N) > .text-\\[10px\\].tracking-wide.uppercase", reason: REASON.CONTRAST, pages: ["desktop-analytics-Findings"] },
  { rule: "color-contrast", selector: ".mb-5:nth-child(N) > .font-semibold.mb-1.tracking-wide", reason: REASON.CONTRAST, pages: ["settings-websites"] },
  { rule: "color-contrast", selector: ".bg-\\[\\#e6f7f4\\]", reason: REASON.CONTRAST, pages: ["settings-websites"] },
  { rule: "color-contrast", selector: ".mt-0\\.5", reason: REASON.CONTRAST, pages: ["settings-websites"] },
  { rule: "color-contrast", selector: ".justify-between.mb-2.w-full > .tracking-wide", reason: REASON.CONTRAST, pages: ["desktop-analytics-Technical"] },
  { rule: "color-contrast", selector: ".mb-5:nth-child(N) > .mb-1.text-\\[11px\\].tracking-wide", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".py-4 > .leading-5", reason: REASON.CONTRAST, pages: ["desktop-analytics-GEO"] },
  { rule: "color-contrast", selector: ".mb-5:nth-child(N) > .mb-1.text-gray-400.tracking-wide", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".mb-4.p-4.rounded-xl:nth-child(N) > .mt-2", reason: REASON.CONTRAST, pages: ["settings-agents"] },
  { rule: "color-contrast", selector: ".mb-3:nth-child(N) > div > .justify-between.mb-1.text-\\[12px\\] > .text-gray-400", reason: REASON.CONTRAST, pages: ["settings-agents"] },
  { rule: "color-contrast", selector: "div:nth-child(N) > .justify-between.mb-1.text-\\[12px\\] > .text-gray-400", reason: REASON.CONTRAST, pages: ["settings-agents"] },
  { rule: "color-contrast", selector: ".mb-4.p-4.rounded-xl:nth-child(N) > .border-t.mt-3.pt-3 > div:nth-child(N) > .text-\\[11px\\].text-gray-400", reason: REASON.CONTRAST, pages: ["settings-agents"] },
  { rule: "color-contrast", selector: ".hover\\:text-gray-600.py-1\\.5.transition-colors:nth-child(N)", reason: REASON.CONTRAST, pages: ["mobile-Analytics"] },
  { rule: "color-contrast", selector: ".gap-0\\.5.py-1.text-\\[10px\\]:nth-child(N)", reason: REASON.CONTRAST, pages: ["mobile-Analytics"] },
  { rule: "color-contrast", selector: "label", reason: REASON.CONTRAST, pages: ["mobile-Context"] },
  { rule: "color-contrast", selector: "h3", reason: REASON.CONTRAST, pages: ["mobile-Context"] },
  { rule: "color-contrast", selector: ".gap-0\\.5.text-\\[10px\\].transition-colors:nth-child(N)", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".gap-1", reason: REASON.CONTRAST, pages: ["settings-llm-providers"] },
  { rule: "color-contrast", selector: ".bg-white.p-4.rounded-xl:nth-child(N) > .mb-2.text-\\[11px\\].text-gray-400", reason: REASON.CONTRAST, pages: ["settings-integrations"] },
  { rule: "color-contrast", selector: ".bg-white.p-4.rounded-xl:nth-child(N) > .gap-3.items-center.mb-3 > .gap-1.hover\\:text-gray-700[target=\"_blank\"]", reason: REASON.CONTRAST, pages: ["settings-integrations"] },
  { rule: "color-contrast", selector: ".bg-white.p-4.rounded-xl:nth-child(N) > .items-start.justify-between.mb-3 > .bg-\\[\\#e6f7f4\\].px-2.text-\\[\\#00846f\\]", reason: REASON.CONTRAST, pages: ["settings-integrations"] },
  { rule: "color-contrast", selector: ".ml-auto", reason: REASON.CONTRAST, pages: ["settings-integrations"] },
  { rule: "color-contrast", selector: ".grid.grid-cols-2.mb-8:nth-child(N) > .bg-white.p-4.rounded-xl > .items-start.justify-between.mb-3 > .bg-\\[\\#e6f7f4\\].px-2.text-\\[\\#00846f\\]", reason: REASON.CONTRAST, pages: ["settings-integrations"] },
  { rule: "color-contrast", selector: ".border.p-4.rounded-xl:nth-child(N) > .flex.gap-3.items-start > .bg-\\[\\#e6f7f4\\].ml-auto.px-2", reason: REASON.CONTRAST, pages: ["settings-api-credentials"] },
  { rule: "color-contrast", selector: ".items-start.justify-between.mb-3 > .bg-\\[\\#e6f7f4\\].px-2.py-0\\.5", reason: REASON.CONTRAST, pages: ["settings-api-credentials"] },
  { rule: "color-contrast", selector: "label:nth-child(N) > .mb-0\\.5.tracking-wide.uppercase", reason: REASON.CONTRAST, pages: ["mobile-Leads"] },
  { rule: "color-contrast", selector: ".gap-2\\.5.group.py-2\\.5:nth-child(N) > .flex-1.min-w-0 > .gap-2.mt-1.text-\\[11px\\] > .bg-gray-100.px-2.py-0\\.5", reason: REASON.CONTRAST, pages: ["mobile-Leads"] },
  { rule: "color-contrast", selector: ".gap-2\\.5.group.py-2\\.5:nth-child(N) > .flex-1.min-w-0 > .gap-2.mt-1.text-\\[11px\\] > a", reason: REASON.CONTRAST, pages: ["mobile-Leads"] },
  { rule: "color-contrast", selector: ".flex-col.py-1.transition-colors:nth-child(N)", reason: REASON.CONTRAST, pages: ["mobile-Leads"] },
  { rule: "color-contrast", selector: ".mt-3", reason: REASON.CONTRAST, pages: ["settings-team"] },
  { rule: "color-contrast", selector: ".my-4", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".mt-4", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".group.relative.w-\\[68px\\]:nth-child(N) > .-right-1.-top-1.rounded-full", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: ".mb-5:nth-child(N) > .text-\\[11px\\].text-gray-400.tracking-wide", reason: REASON.CONTRAST },
  { rule: "color-contrast", selector: "a[href$=\"terms\"]", reason: REASON.CONTRAST, pages: ["login-signup"] },
  { rule: "color-contrast", selector: "a[href$=\"privacy\"]", reason: REASON.CONTRAST, pages: ["login-signup"] },
  { rule: "color-contrast", selector: ".mb-4.relative:nth-child(N) > .-translate-y-1\\/2.absolute.top-1\\/2", reason: REASON.CONTRAST, pages: ["settings-personalization"] },
  { rule: "color-contrast", selector: ".bottom-2", reason: REASON.CONTRAST, pages: ["settings-personalization"] },
];
