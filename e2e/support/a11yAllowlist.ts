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
  CONTRAST: "Signed-out login page only (not part of the dashboard/settings contrast pass). Fix: text-ui-subtle / text-ui-accent-strong tokens.",
  BUTTON_NAME: "Icon-only button without an accessible name. Fix: add aria-label (and aria-hidden on the icon).",
  LABEL: "Form control without a label. Fix: aria-label, or wrap in a <label>.",
  SELECT_NAME: "<select> without a label. Fix: aria-label or an associated <label>.",
  SVG_ALT: "Brand icon rendered as role=img without a title. Fix: aria-hidden on decorative brand icons, or pass title.",
  SCROLL_FOCUS: "Scrollable region cannot be reached by keyboard. Fix: tabIndex=0 plus an aria-label on the scroll container.",
};

export const A11Y_ALLOWLIST: AllowedViolation[] = [
  { rule: "button-name", selector: ".gap-3.items-center > .hover\\:text-gray-600", reason: REASON.BUTTON_NAME, pages: ["desktop-1280-log-open"] },
  { rule: "color-contrast", selector: ".gap-1\\.5.group.w-\\[68px\\]:nth-child(N) > .-right-1.-top-1.rounded-full", reason: REASON.CONTRAST, pages: ["login-signin","login-signup"] },
  { rule: "color-contrast", selector: ".leading-5", reason: REASON.CONTRAST, pages: ["login-signup"] },
  { rule: "color-contrast", selector: ".mt-4", reason: REASON.CONTRAST, pages: ["login-signin","login-signup"] },
  { rule: "color-contrast", selector: ".my-4", reason: REASON.CONTRAST, pages: ["login-signin","login-signup"] },
  { rule: "color-contrast", selector: "a[href$=\"privacy\"]", reason: REASON.CONTRAST, pages: ["login-signup"] },
  { rule: "color-contrast", selector: "a[href$=\"terms\"]", reason: REASON.CONTRAST, pages: ["login-signup"] },
];
