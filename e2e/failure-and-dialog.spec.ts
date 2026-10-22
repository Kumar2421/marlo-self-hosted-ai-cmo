import { test, expect } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// A failed or offline request must end in an error state with a way out, and the
// document viewer must behave like the Findings drawer (a real, keyboard-closable dialog).

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 730 } });

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
});

test("document viewer is a dialog: labelled, Esc closes, focus returns to the row", async ({ page }) => {
  await page.goto("/dashboard");
  const row = page.getByRole("button", { name: /Product Information/ }).first();
  await row.click();

  const dialog = page.getByRole("dialog", { name: "Product Information" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
});

test("the dashboard has main and nav landmarks and one h1", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("a failed Traffic request shows an error with Try again instead of a skeleton", async ({ page }) => {
  await page.route("**/api/agents/analytics/traffic", (route) => route.abort("failed"));
  await page.goto("/dashboard");
  const panel = page.locator("div[style*='grid-template-columns'] > *").nth(1);
  await panel.getByRole("tab", { name: "Traffic", exact: true }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Network error/)).toBeVisible();
});

test("a failed project switch toasts, closes the menu and keeps the current project", async ({ page }) => {
  const current = { id: "11111111-1111-4111-8111-111111111111", name: "Acme Invoice", url: "https://acme.example.test" };
  const other = { id: "proj_other", name: "Other site", url: "https://other.example.test" };
  await page.route("**/api/project", (route) => route.fulfill({ json: { project: current, projects: [current, other] } }));
  await page.route("**/api/project/switch", (route) => route.abort("failed"));
  await page.goto("/dashboard");

  const bar = page.getByTestId("terminal-bar");
  await bar.getByRole("button", { name: current.name }).click();
  await page.getByRole("button", { name: "Other site" }).click();

  await expect(page.getByText(/Network error/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Other site" })).toBeHidden();
  await expect(bar).toContainText(current.name);
});
