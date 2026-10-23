import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";
import { expectNoNewViolations } from "./support/a11y.ts";
import { makeActivity, statusToggle } from "./support/headerActivity.ts";

// Theme setting (Light / Dark / System): stored choice, no flash before paint, live follow-system,
// the Settings > Account control and the user-menu toggle. THEME_SHOTS=<dir> also saves screenshots of
// the main surfaces in both themes (used for visual review, not as baselines).

test.describe.configure({ timeout: 90_000 });

const SHOTS = process.env.THEME_SHOTS;
const root = (page: Page) => page.locator("html");
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const TRAFFIC = {
  range: { startDate: "2026-01-01", endDate: "2026-01-28" },
  site: "sc-domain:acme.example.test",
  propertyName: null,
  byDate: Array.from({ length: 28 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, clicks: 10 + ((i * 7) % 13), impressions: 300 + i * 9, ctr: 0.035, position: 8 })),
  topQueries: [{ query: "invoice software", clicks: 20, impressions: 500, ctr: 0.04, position: 6.1 }],
  opportunities: [],
  search: null,
  totals: { clicks: 270, impressions: 9000, ctr: 0.038, position: 8 },
  status: "ok",
  reason: null,
  needs_reconnect: false,
  gscError: null,
  ga4: null,
  ga4Error: null,
};

const finding = {
  id: "finding_lh",
  projectId: "11111111-1111-4111-8111-111111111111",
  source: "seo-audit",
  category: "accessibility",
  entityType: "page",
  entityId: "lighthouse-button-name",
  url: "https://acme.example.test/",
  severity: "warning",
  evidence: { label: "Buttons do not have an accessible name", auditId: "button-name", device: "mobile", mode: "diagnostic", score: null, displayValue: "3 elements" },
  recommendation: "Give every button a text label or an aria-label.",
  status: "new",
  firstSeen: "2026-01-01T00:00:00Z",
  lastSeen: "2026-01-01T00:00:00Z",
  resolvedAt: null,
};

async function hideDevBadge(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const st = document.createElement("style");
      st.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(st);
    });
  });
}

test.describe("theme setting", () => {
  test.use({ viewport: { width: 1536, height: 800 } });

  test.beforeEach(async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await mockDashboardApi(page);
    await serveLottieWasmLocally(page);
    await hideDevBadge(page);
  });

  test("defaults to system and follows the OS live, without a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings/account");
    await expect(root(page)).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    const light = await bodyBg(page);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(root(page)).toHaveAttribute("data-theme", "dark");
    expect(await bodyBg(page)).not.toBe(light);
    expect(await root(page).evaluate((el) => (el as HTMLElement).style.colorScheme)).toBe("dark");

    await page.emulateMedia({ colorScheme: "light" });
    await expect(root(page)).toHaveAttribute("data-theme", "light");
  });

  test("an explicit choice wins over the OS and survives a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings/account");
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(root(page)).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("marlo-theme"))).toBe("dark");
    // The OS flipping must not override an explicit choice.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await expect(root(page)).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(root(page)).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");

    await page.getByRole("radio", { name: "Light" }).click();
    await expect(root(page)).toHaveAttribute("data-theme", "light");
    await page.getByRole("radio", { name: "System" }).click();
    await expect(root(page)).toHaveAttribute("data-theme", "light");
  });

  test("data-theme is set before first paint (inline script, no flash)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => localStorage.setItem("marlo-theme", "dark"));
    // Record the attribute at the first paint: the head script must already have run by then.
    await page.addInitScript(() => {
      new PerformanceObserver((list) => {
        const w = window as unknown as { __themeAtPaint?: string | null };
        if (w.__themeAtPaint === undefined && list.getEntries().length) w.__themeAtPaint = document.documentElement.getAttribute("data-theme");
      }).observe({ type: "paint", buffered: true });
    });
    await page.goto("/settings/account");
    await page.waitForFunction(() => (window as unknown as { __themeAtPaint?: string }).__themeAtPaint !== undefined);
    expect(await page.evaluate(() => (window as unknown as { __themeAtPaint?: string }).__themeAtPaint)).toBe("dark");
  });

  test("a broken stored value falls back to system", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => localStorage.setItem("marlo-theme", "purple"));
    await page.goto("/settings/account");
    await expect(root(page)).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
  });

  test("the user menu has a labelled Light / Dark / System control that applies immediately", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" }); // dark OS: System looks like Dark, so the check must be on state
    await page.addInitScript(() => localStorage.setItem("marlo-theme", "light"));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Account menu" }).click();
    const group = page.getByRole("radiogroup", { name: "Theme" }).filter({ visible: true });
    await expect(group.getByRole("radio")).toHaveText(["Light", "Dark", "System"]);
    await expect(group.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    await group.getByRole("radio", { name: "Dark" }).click();
    await expect(root(page)).toHaveAttribute("data-theme", "dark");
    await expect(group.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    await expect(group.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "false");
    await group.getByRole("radio", { name: "Light" }).click();
    await expect(root(page)).toHaveAttribute("data-theme", "light");
    await group.getByRole("radio", { name: "System" }).click();
    // The selected option is shown even though System resolves to the same look as Dark.
    await expect(group.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    await expect(root(page)).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("marlo-theme"))).toBe("system");
  });

  test("the user menu and Settings controls share one preference", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("radiogroup", { name: "Theme" }).filter({ visible: true }).getByRole("radio", { name: "Dark" }).click();
    await page.goto("/settings/account");
    await expect(page.getByRole("radiogroup", { name: "Appearance" }).filter({ visible: true }).getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });

  test("palette: warm page and card surfaces, white pill primary in dark, warm black in light", async ({ page }) => {
    const rgb = (sel: string, prop: string) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/dashboard");
    await expect(root(page)).toHaveAttribute("data-theme", "dark");
    expect(await bodyBg(page)).toBe("rgb(17, 15, 14)"); // #110f0e, same as the top bar
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-white").trim())).toBe("#1c1917");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--solid-bg").trim())).toMatch(/^#fff(fff)?$/);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(root(page)).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--solid-bg").trim())).toBe("#110f0e");
    expect(await rgb("body", "color")).toBe("rgb(28, 25, 23)"); // stone-900
  });

  test("the top bar stays dark in both themes", async ({ page }) => {
    const barBg = () => page.getByTestId("terminal-bar").evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle"); // the follow-system listener attaches on hydration
    const light = await barBg();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(root(page)).toHaveAttribute("data-theme", "dark");
    expect(await barBg()).toBe(light);
  });
});

test.describe("dark mode accessibility (colour contrast)", () => {
  test.use({ viewport: { width: 1536, height: 800 }, colorScheme: "dark" });

  test.beforeEach(async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await mockDashboardApi(page);
    await serveLottieWasmLocally(page);
    await hideDevBadge(page);
  });

  // Page labels match e2e/a11y.spec.ts so the allowlisted, pre-existing (theme-independent) findings stay allowlisted.
  for (const tab of ["SEO", "Links", "Technical", "GEO", "Findings"]) {
    test(`dashboard ${tab}`, async ({ page }, testInfo) => {
      await page.goto("/dashboard");
      await expect(root(page)).toHaveAttribute("data-theme", "dark");
      await page.locator('[role="tablist"][aria-label="Analytics sections"], nav[aria-label="Dashboard sections"]').first().waitFor();
      await page.locator(`#analytics-tab-${tab}`).click();
      await page.waitForLoadState("networkidle");
      await expectNoNewViolations(page, `desktop-1280-analytics-${tab}`, testInfo);
    });
  }

  for (const slug of ["websites", "credits", "llm-providers", "api-credentials", "agents", "integrations", "team", "personalization", "account", "notifications"]) {
    test(`/settings/${slug}`, async ({ page }, testInfo) => {
      await page.goto(`/settings/${slug}`);
      await expect(root(page)).toHaveAttribute("data-theme", "dark");
      await page.waitForLoadState("networkidle");
      await expectNoNewViolations(page, `settings-1280-${slug}`, testInfo);
    });
  }

  test("pricing and login", async ({ page, context }, testInfo) => {
    await context.clearCookies();
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
    await expectNoNewViolations(page, "dark-pricing", testInfo);
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).waitFor();
    await expectNoNewViolations(page, "login-signin", testInfo);
  });
});

test.describe("screenshots (THEME_SHOTS)", () => {
  test.skip(!SHOTS, "set THEME_SHOTS=<dir> to capture");
  test.use({ viewport: { width: 1536, height: 900 } });

  for (const scheme of ["light", "dark"] as const) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      test.beforeEach(async ({ page, context, baseURL }) => {
        await signIn(context, baseURL!);
        await mockDashboardApi(page);
        await serveLottieWasmLocally(page);
        await hideDevBadge(page);
        await page.route("**/api/agents/analytics/findings", (r) =>
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ findings: [finding] }) }),
        );
        // dashboardMock has no traffic endpoint and the panel crashes on the empty fallback body.
        await page.route("**/api/agents/analytics/traffic", (r) =>
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TRAFFIC) }),
        );
      });

      test("dashboard", async ({ page }) => {
        await page.goto("/dashboard");
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${SHOTS}/${scheme}-dashboard.png` });
        for (const tab of ["SEO", "Links", "Technical", "GEO", "Traffic", "Findings"]) {
          const t = page.locator(`#analytics-tab-${tab}`);
          if (await t.count()) {
            await t.click();
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${SHOTS}/${scheme}-dashboard-${tab}.png` });
          }
        }
      });

      test("finding drawer", async ({ page }) => {
        await page.goto("/dashboard");
        await page.getByTestId("fix-first").getByRole("button").first().click();
        await page.getByRole("dialog").waitFor();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/${scheme}-drawer.png` });
      });

      test("user menu and status log", async ({ page }) => {
        await page.goto("/dashboard");
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "Account menu" }).click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/${scheme}-usermenu.png`, clip: { x: 900, y: 0, width: 636, height: 420 } });
      });

      test("header popovers and status log", async ({ page }) => {
        await page.goto("/dashboard");
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: /Acme Invoice/ }).first().click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/${scheme}-project-switcher.png`, clip: { x: 0, y: 0, width: 700, height: 360 } });
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: /^Social/ }).click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/${scheme}-social-menu.png`, clip: { x: 900, y: 0, width: 636, height: 420 } });
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: /Notifications|notification/i }).first().click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/${scheme}-notifications.png` });
      });

      test("status log open", async ({ page }) => {
        await page.goto("/dashboard");
        await page.waitForLoadState("networkidle");
        await makeActivity(page);
        await statusToggle(page).click();
        await page.getByRole("log").waitFor();
        await page.screenshot({ path: `${SHOTS}/${scheme}-status-log.png`, clip: { x: 0, y: 0, width: 1536, height: 300 } });
      });

      for (const slug of ["websites", "credits", "integrations", "account", "llm-providers", "api-credentials", "agents", "team", "notifications", "personalization"]) {
        test(`settings ${slug}`, async ({ page }) => {
          await page.goto(`/settings/${slug}`);
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(400);
          await page.screenshot({ path: `${SHOTS}/${scheme}-settings-${slug}.png` });
        });
      }

      test("login and pricing", async ({ page, context }) => {
        await context.clearCookies();
        await page.goto("/login");
        await page.getByLabel("Email", { exact: true }).waitFor();
        await page.screenshot({ path: `${SHOTS}/${scheme}-login.png` });
        await page.goto("/pricing");
        await page.getByRole("heading", { level: 1, name: "Pricing" }).waitFor();
        await page.screenshot({ path: `${SHOTS}/${scheme}-pricing.png`, fullPage: true });
      });
    });
  }
});
