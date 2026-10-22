import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, signIn } from "./support/dashboardMock.ts";
import { expectBarSilent, makeActivity, statusToggle } from "./support/headerActivity.ts";

// Compact dashboard shell: phone (<768) shows one panel at a time, tablet
// (768-1099) shows two panes, and in both the panels stay mounted when hidden.

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, panes: 1 },
  { name: "tablet", width: 820, height: 1180, panes: 2 },
];

const consoleErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, context, baseURL }) => {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on("console", (m) => {
    // dashboardMock does not serve the social *-drafts endpoints, so react-query
    // logs "Query data cannot be undefined" for them. Mock gap, not the shell.
    // The loading screen's lottie fetch is aborted when it unmounts (pre-existing).
    const known = /Query data cannot be undefined.*-drafts|ghost-loader\.lottie/;
    if (m.type() === "error" && !known.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  // The Next dev-only indicator badge sits over the bottom-left tab and eats clicks.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const st = document.createElement("style");
      st.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(st);
    });
  });
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
});

async function open(page: Page, query = "") {
  await page.goto(`/dashboard${query}`);
  await expect(page.getByRole("tablist", { name: "Dashboard sections" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name });

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("no horizontal overflow, tab semantics and 48px targets", async ({ page }) => {
      await open(page);
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        scrollH: document.documentElement.scrollHeight,
        vh: window.innerHeight,
      }));
      expect(m.scrollW).toBeLessThanOrEqual(m.clientW);
      expect(m.scrollH).toBeLessThanOrEqual(m.vh);

      // Scoped to the bottom bar: the Leads panel has its own filter tabs (All / With email / No email).
      const bar = page.getByRole("navigation", { name: "Dashboard sections" });
      const tabs = bar.getByRole("tab");
      await expect(tabs).toHaveCount(4);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Dashboard sections" })).toBeVisible();
      for (let i = 0; i < 4; i++) {
        const box = (await tabs.nth(i).boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(48);
        expect(box.width).toBeGreaterThanOrEqual(48);
      }
      // A project with an audit lands on Analytics (Findings), not Context.
      await expect(tab(page, "Analytics")).toHaveAttribute("aria-selected", "true");
      await expect(bar.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
      await expect(bar.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);

      // Roving tabindex + arrow keys.
      await tab(page, "Context").focus();
      await page.keyboard.press("ArrowRight");
      await expect(tab(page, "Analytics")).toBeFocused();
      await expect(tab(page, "Analytics")).toHaveAttribute("aria-selected", "true");
      await expect(tab(page, "Analytics")).toHaveAttribute("tabindex", "0");
      await expect(tab(page, "Context")).toHaveAttribute("tabindex", "-1");
      await page.keyboard.press("End");
      await expect(tab(page, "Chat")).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(tab(page, "Context")).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");

      // Visible panes: 1 on phone, 2 on tablet; the rest are hidden + inert.
      await expect(page.locator('section[role="tabpanel"]:not([hidden])')).toHaveCount(vp.panes);
      const hidden = page.locator('section[role="tabpanel"][hidden]');
      await expect(hidden).toHaveCount(4 - vp.panes);
      for (const el of await hidden.all()) {
        await expect(el).toHaveAttribute("aria-hidden", "true");
        await expect(el).toHaveAttribute("inert", "");
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("switching tabs keeps a chat draft and scroll position", async ({ page }) => {
      await open(page, "?tab=agents");
      await expect(page.getByText("Very Long Lead Name Number 1 With").first()).toBeVisible();

      const scrollTo = await page.evaluate(() => {
        const panel = document.getElementById("dash-panel-agents")!;
        const el = [...panel.querySelectorAll<HTMLElement>("div")].find(
          (d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight + 200,
        )!;
        el.setAttribute("data-e2e-scroll", "1");
        el.scrollTop = 400;
        return el.scrollTop;
      });
      expect(scrollTo).toBeGreaterThan(100);

      await tab(page, "Chat").click();
      const box = page.getByPlaceholder("Ask me anything...");
      await box.fill("draft that must survive");

      await tab(page, "Analytics").click();
      await tab(page, "Chat").click();
      await expect(box).toHaveValue("draft that must survive");

      await tab(page, "Leads").click();
      await expect(page.getByText("Very Long Lead Name Number 1 With").first()).toBeAttached();
      const after = await page.evaluate(
        () => document.querySelector<HTMLElement>('[data-e2e-scroll="1"]')?.scrollTop ?? -1,
      );
      expect(Math.abs(after - scrollTo)).toBeLessThanOrEqual(2);
    });

    test("?tab= deep link, replaceState (no history spam), reload and invalid fallback", async ({ page }) => {
      await open(page, "?tab=chat");
      await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByPlaceholder("Ask me anything...")).toBeVisible();

      const historyBefore = await page.evaluate(() => history.length);
      await tab(page, "Analytics").click();
      await expect(page).toHaveURL(/[?&]tab=analytics/);
      await tab(page, "Leads").click();
      await expect(page).toHaveURL(/[?&]tab=agents/);
      expect(await page.evaluate(() => history.length)).toBe(historyBefore);

      await page.reload();
      await expect(tab(page, "Leads")).toHaveAttribute("aria-selected", "true");

      // An invalid ?tab= is ignored: with nothing remembered, the audited project's default applies.
      await page.evaluate(() => localStorage.clear());
      await open(page, "?tab=bogus");
      await expect(tab(page, "Analytics")).toHaveAttribute("aria-selected", "true");
    });

    test("first screen: Analytics with an audit; Context while setup is unfinished", async ({ page }) => {
      await open(page);
      await expect(tab(page, "Analytics")).toHaveAttribute("aria-selected", "true");
      const shown = page.locator('section[role="tabpanel"]:not([hidden])');
      await expect(shown).toHaveCount(vp.panes);
      await expect(page.locator("#dash-panel-analytics")).toBeVisible();
      await expect(page.locator("#dash-panel-context")).toBeHidden();
      if (vp.panes === 2) {
        // Tablet pair is Analytics + Chat, not Context + Leads; Leads is one tap away.
        await expect(page.locator("#dash-panel-chat")).toBeVisible();
        await expect(page.locator("#dash-panel-agents")).toBeHidden();
      }
      await tab(page, "Leads").click();
      await expect(page.locator("#dash-panel-agents")).toBeVisible();

      // No audit yet: setup lives in Context.
      await page.unroute("**/api/**");
      await mockDashboardApi(page, { noAudit: true });
      await page.evaluate(() => localStorage.clear());
      await open(page);
      await expect(tab(page, "Context")).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#dash-panel-context")).toBeVisible();
    });

    test("last-used tab beats the default; ?tab= beats the last-used tab", async ({ page }) => {
      await open(page);
      await tab(page, "Chat").click();
      await page.goto("/dashboard"); // no ?tab=: the stored choice wins over Analytics
      await expect(tab(page, "Chat")).toHaveAttribute("aria-selected", "true");
      await open(page, "?tab=context");
      await expect(tab(page, "Context")).toHaveAttribute("aria-selected", "true");
    });

    test("idle header is quiet and the bar stays 48px", async ({ page }) => {
      await open(page);
      const bar = page.getByTestId("terminal-bar");
      await expect(bar).not.toContainText("No activity");
      await expect(bar).not.toContainText("Status Log");
      await expect(statusToggle(page)).toHaveCount(0);
      await expectBarSilent(page);
      expect((await bar.boundingBox())!.height).toBe(48);
      await makeActivity(page);
      expect((await bar.boundingBox())!.height).toBe(48);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });

    test("panels mount lazily", async ({ page }) => {
      await open(page, "?tab=context");
      const filled = await page.evaluate(
        () => [...document.querySelectorAll('section[role="tabpanel"]')].filter((p) => p.childElementCount > 0).length,
      );
      expect(filled).toBe(vp.panes);
    });

    test("no console errors", async ({ page }) => {
      await open(page);
      for (const name of ["Analytics", "Leads", "Chat", "Context"]) await tab(page, name).click();
      await page.waitForLoadState("networkidle");
      expect(consoleErrors.get(page)).toEqual([]);
    });
  });
}

test.describe("desktop is unchanged", () => {
  test.use({ viewport: { width: 1100, height: 800 } });
  test("1100px still renders the four-column grid without a tab bar", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("terminal-bar")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Dashboard sections" })).toHaveCount(0);
  });
});
