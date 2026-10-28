import { expect, test, type Page } from "@playwright/test";
import { expectNoNewViolations } from "./support/a11y.ts";
import { PLAN_PRICES } from "../lib/domain/plans/planMatrix.ts";
import { PRICING_BETA_NOTE } from "../lib/domain/plans/pricingView.ts";

// Public /pricing page: renders from the plan matrix, annual toggle, waitlist
// dialog (the API route is mocked), keyboard behaviour and axe.
// Set PRICING_SHOTS=<dir> to also save screenshots.

test.describe.configure({ timeout: 90_000 });

type WaitlistCall = Record<string, unknown>;

async function mockWaitlist(page: Page, calls: WaitlistCall[], respond: { status: number; body: unknown } = { status: 200, body: { ok: true } }) {
  await page.route("**/api/waitlist", async (route) => {
    calls.push(route.request().postDataJSON() as WaitlistCall);
    await route.fulfill({ status: respond.status, contentType: "application/json", body: JSON.stringify(respond.body) });
  });
}

const money = (n: number) => `$${n}`;

async function openPricing(page: Page) {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
}

test.describe("pricing page", () => {
  test("renders Free, Lite and Pro from the plan matrix, with the beta label", async ({ page }) => {
    await openPricing(page);
    await expect(page.locator("section[data-plan]")).toHaveCount(3);
    for (const [id, name] of [["free", "Free"], ["lite", "Lite"], ["pro", "Pro"]] as const) {
      const card = page.locator(`section[data-plan="${id}"]`);
      await expect(card.getByRole("heading", { level: 2, name })).toBeVisible();
      await expect(page.getByTestId(`price-${id}`)).toContainText(money(PLAN_PRICES[id].monthly));
    }
    await expect(page.getByText("Beta", { exact: true })).toBeVisible();
    await expect(page.getByText(PRICING_BETA_NOTE)).toBeVisible();
    await expect(page.getByText("Most popular")).toBeVisible();
    await expect(page.getByRole("link", { name: "Start free" })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("button", { name: "Join the waitlist" })).toHaveCount(2);
    await expect(page.getByText(/Marlo is open source\./)).toBeVisible();
    await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", /github\.com\/Kumar2421\/marlo-self-hosted-ai-cmo/);
    await expect(page.getByRole("link", { name: "Self-host docs" })).toBeVisible();
  });

  test("annual toggle shows the per-month annual prices from PLAN_PRICES", async ({ page }) => {
    await openPricing(page);
    await expect(page.getByRole("tablist", { name: "Billing interval" })).toBeVisible();
    await page.getByRole("tab", { name: "Annual" }).click();
    await expect(page.getByRole("tab", { name: "Annual" })).toHaveAttribute("aria-selected", "true");
    for (const id of ["free", "lite", "pro"] as const) {
      await expect(page.getByTestId(`price-${id}`)).toContainText(money(PLAN_PRICES[id].annualPerMonth));
    }
    await expect(page.locator('section[data-plan="lite"]')).toContainText(`Billed ${money(PLAN_PRICES.lite.annualTotal)} per year`);
    await expect(page.locator('section[data-plan="lite"]').getByText("2 months free")).toBeVisible();
    await page.getByRole("tab", { name: "Monthly" }).click();
    await expect(page.getByTestId("price-lite")).toContainText(money(PLAN_PRICES.lite.monthly));
  });

  test("toggle works with the keyboard (arrow keys)", async ({ page }) => {
    await openPricing(page);
    await page.getByRole("tab", { name: "Monthly" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Annual" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("price-pro")).toContainText(money(PLAN_PRICES.pro.annualPerMonth));
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Monthly" })).toHaveAttribute("aria-selected", "true");
  });

  test("the + expander on a feature row reveals its description", async ({ page }) => {
    await openPricing(page);
    const row = page.locator('section[data-plan="lite"]').getByRole("button", { name: /Coding agent/ });
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(/pull requests that fix findings/)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-expanded", "false");
  });

  test("waitlist dialog validates, posts the plan and interval, and shows success", async ({ page }) => {
    const calls: WaitlistCall[] = [];
    await mockWaitlist(page, calls);
    await openPricing(page);
    await page.getByRole("tab", { name: "Annual" }).click();

    await page.locator('section[data-plan="lite"]').getByRole("button", { name: "Join the waitlist" }).click();
    const dialog = page.getByRole("dialog", { name: "Join the Lite waitlist" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(dialog.getByRole("alert")).toContainText("valid email");
    expect(calls).toHaveLength(0);

    await dialog.getByLabel("Email").fill("not-an-email");
    await dialog.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(dialog.getByRole("alert")).toContainText("valid email");

    await dialog.getByLabel("Email").fill("Founder@Example.com");
    await dialog.getByLabel(/Website/).fill("not a url");
    await dialog.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(dialog.getByRole("alert")).toContainText("valid website");
    expect(calls).toHaveLength(0);

    await dialog.getByLabel(/Website/).fill("acme.dev");
    await dialog.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(dialog.getByText("You are on the list.")).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ email: "Founder@Example.com", website: "acme.dev", plan: "lite", interval: "annual", company_url: "" });

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
  });

  test("a server error is shown and the form stays editable", async ({ page }) => {
    const calls: WaitlistCall[] = [];
    await mockWaitlist(page, calls, { status: 429, body: { error: "Too many requests. Please wait a minute and try again." } });
    await openPricing(page);
    await page.locator('section[data-plan="pro"]').getByRole("button", { name: "Join the waitlist" }).click();
    const dialog = page.getByRole("dialog", { name: "Join the Pro waitlist" });
    await dialog.getByLabel("Email").fill("a@b.co");
    await dialog.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Too many requests");
    await expect(dialog.getByLabel("Email")).toBeEditable();
    expect(calls[0]).toMatchObject({ plan: "pro", interval: "monthly" });
  });

  test("dialog traps focus, Esc closes it and focus returns to the trigger", async ({ page }) => {
    await openPricing(page);
    const trigger = page.locator('section[data-plan="lite"]').getByRole("button", { name: "Join the waitlist" });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

for (const viewport of [
  { name: "1280", width: 1280, height: 900 },
  { name: "390", width: 390, height: 844 },
]) {
  test.describe(`pricing at ${viewport.name}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("no horizontal scroll, axe clean, dialog axe clean", async ({ page }, testInfo) => {
      await openPricing(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await expectNoNewViolations(page, `pricing-${viewport.name}`, testInfo);

      await page.getByRole("tab", { name: "Annual" }).click();
      await page.locator('section[data-plan="pro"]').getByRole("button", { name: /Leads finder/ }).click();
      await expectNoNewViolations(page, `pricing-${viewport.name}-annual-expanded`, testInfo);

      const dir = process.env.PRICING_SHOTS;
      if (dir) await page.screenshot({ path: `${dir}/pricing-${viewport.name}.png`, fullPage: true });

      await page.locator('section[data-plan="pro"]').getByRole("button", { name: "Join the waitlist" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoNewViolations(page, `pricing-${viewport.name}-dialog`, testInfo);
      if (dir) await page.screenshot({ path: `${dir}/pricing-${viewport.name}-dialog.png` });
    });
  });
}
