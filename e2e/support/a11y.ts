import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { A11Y_ALLOWLIST } from "./a11yAllowlist.ts";

export type Violation = {
  page: string;
  rule: string;
  impact: string;
  selector: string;
  help: string;
  /** Nodes that collapsed into this row. */
  count: number;
};

const BLOCKING = new Set(["serious", "critical"]);

// A run of class selectors such as `.group.gap-2\.5.py-2\.5` (escaped characters stay inside a token).
const CLASS_RUN = /(?:\.(?:\\.|[^.\s>+~:[\]()])+)+/g;
const CLASS_TOKEN = /\.(?:\\.|[^.\s>+~:[\]()])+/g;

/**
 * Makes selectors stable between runs:
 * - List rows differ only by position, so `:nth-child(7)` becomes `:nth-child(N)`. One
 *   allowlist entry then covers a repeated row (60 leads) without covering new components.
 * - Axe orders an element's classes by how common they are on the page, which changes with
 *   how many rows are rendered, so the classes of each compound selector are sorted.
 * - Axe picks a different subset of an icon's presentation attributes from run to run
 *   (`svg[fill="currentColor"]` vs `svg[stroke-width="0"]`), so those are dropped.
 */
export function normalizeSelector(target: string): string {
  return target
    .replace(/:nth-child\(\d+\)/g, ":nth-child(N)")
    .replace(/\[(?:fill|stroke|stroke-width|color|height|width|viewBox)="[^"]*"\]/g, "")
    .replace(CLASS_RUN, (run) => (run.match(CLASS_TOKEN) ?? []).sort().join(""));
}

/** Runs axe on the current page and returns serious/critical findings, one row per distinct rule+selector. */
export async function scan(page: Page, label: string): Promise<Violation[]> {
  const results = await new AxeBuilder({ page }).analyze();
  const rows = new Map<string, Violation>();
  for (const v of results.violations) {
    if (!v.impact || !BLOCKING.has(v.impact)) continue;
    for (const node of v.nodes) {
      const selector = normalizeSelector(node.target.join(" >> "));
      const row = rows.get(`${v.id}|${selector}`);
      if (row) row.count += 1;
      else rows.set(`${v.id}|${selector}`, { page: label, rule: v.id, impact: v.impact, selector, help: v.help, count: 1 });
    }
  }
  return [...rows.values()];
}

/** A11Y_AUDIT=1 ignores the allowlist, so every current violation is printed and reported. */
const AUDIT = process.env.A11Y_AUDIT === "1";

export function isAllowed(v: Violation): boolean {
  if (AUDIT) return false;
  return A11Y_ALLOWLIST.some(
    (a) => a.rule === v.rule && a.selector === v.selector && (!a.pages || a.pages.includes(v.page)),
  );
}

/** Fails on serious/critical violations that are not in the allowlist; prints all current ones. */
export async function expectNoNewViolations(page: Page, label: string, testInfo: TestInfo) {
  // A crashed page would only be scanned as its error screen; report the crash instead.
  await expect(page.locator("#__next_error__"), `"${label}" rendered the Next.js error page`).toHaveCount(0);
  // Axe picks selectors from whatever siblings exist right now, so let late fetches, transitions and skeletons finish first.
  await page.waitForTimeout(1000);
  const rows = await scan(page, label);
  for (const r of rows) {
    console.log(`[a11y] ${r.page} | ${r.impact} | ${r.rule} | ${r.selector} | x${r.count}`);
  }
  await testInfo.attach(`a11y-${label}.json`, { body: JSON.stringify(rows, null, 2), contentType: "application/json" });
  const fresh = rows.filter((r) => !isAllowed(r));
  expect(
    fresh,
    `New serious/critical a11y violations on "${label}". Fix them, or (with a reason) add them to e2e/support/a11yAllowlist.ts:\n` +
      fresh.map((r) => `  ${r.impact} ${r.rule}: ${r.selector}  (${r.help})`).join("\n"),
  ).toEqual([]);
}
