import { expect, type Page } from "@playwright/test";

/** Header status button (only rendered once the log has a line). */
export const statusToggle = (page: Page) => page.locator('[data-testid="terminal-bar"] button[aria-controls="terminal-log-panel"]');

/**
 * Produces a real log line the way a user would: Analytics > Links > Check
 * reachability logs "Checking link reachability..." (the mock answers `{}`, so
 * a failure line follows). Needs the Analytics panel on screen.
 */
export async function makeActivity(page: Page) {
  await page.getByRole("tablist").getByRole("tab", { name: "Links", exact: true }).or(page.getByRole("button", { name: "Links", exact: true })).first().click();
  await page.getByRole("button", { name: /Check reachability/ }).click();
  await expect(statusToggle(page)).toBeVisible();
}

/** Nothing in the header bar is exposed as a live region (aria-hidden subtrees are skipped by role queries). */
export async function expectBarSilent(page: Page) {
  const bar = page.getByTestId("terminal-bar");
  for (const role of ["status", "alert", "log"] as const) await expect(bar.getByRole(role)).toHaveCount(0);
  await expect(bar.locator("[aria-live]")).toHaveCount(0);
}
