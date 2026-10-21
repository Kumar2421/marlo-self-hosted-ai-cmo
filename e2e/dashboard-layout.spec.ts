import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, signIn } from "./support/dashboardMock.ts";

// Layout regression for the signed-in dashboard: the page must never scroll, the
// four panels must end at the viewport bottom, and the header must stay compact.
// Server auth is satisfied by the fake Supabase server (see support/fakeSupabaseServer.ts).

const VIEWPORTS = [
  { width: 1888, height: 867 },
  { width: 1536, height: 730 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
];

type Metrics = {
  vh: number;
  scrollH: number;
  scrollW: number;
  clientW: number;
  header: number;
  headerBar: number;
  bottoms: number[];
  heights: number[];
};

async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const grid = [...document.querySelectorAll<HTMLElement>("div")].find((d) => d.style.gridTemplateColumns)!;
    const panels = [...grid.children].map((p) => p.getBoundingClientRect());
    const bar = document.querySelector<HTMLElement>('[data-testid="terminal-bar"]')!;
    return {
      vh: window.innerHeight,
      scrollH: de.scrollHeight,
      scrollW: de.scrollWidth,
      clientW: de.clientWidth,
      header: bar.parentElement!.getBoundingClientRect().height,
      headerBar: bar.getBoundingClientRect().height,
      bottoms: panels.map((r) => Math.round(r.bottom)),
      heights: panels.map((r) => Math.round(r.height)),
    };
  });
}

async function openDashboard(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByTestId("terminal-bar")).toBeVisible();
  await expect(page.getByText("Very Long Lead Name Number 0").first()).toBeVisible();
  // Let panel skeletons and late fetches settle before measuring.
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
});

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test("fits the viewport with a compact header", async ({ page }) => {
      await openDashboard(page);
      const m = await measure(page);
      expect(m.scrollH).toBeLessThanOrEqual(m.vh);
      expect(m.scrollW).toBeLessThanOrEqual(m.clientW);
      expect(m.headerBar).toBeLessThanOrEqual(56);
      expect(m.header).toBeLessThanOrEqual(64);
      expect(m.bottoms).toHaveLength(4);
      for (const b of m.bottoms) expect(b).toBe(m.vh);
    });

    test("Leads results keep at least 200px with 60 leads and the profile form open", async ({ page }) => {
      await openDashboard(page);
      await page.getByText("Custom search").click();
      const leads = await page.evaluate(() => {
        const grid = [...document.querySelectorAll<HTMLElement>("div")].find((d) => d.style.gridTemplateColumns)!;
        const panel = grid.children[2] as HTMLElement;
        const region = [...panel.querySelectorAll<HTMLElement>("div")].find((d) => getComputedStyle(d).overflowY === "auto" && d.clientHeight > 0)!;
        const before = region.clientHeight;
        region.scrollTop = region.scrollHeight;
        const rows = [...region.querySelectorAll("input[type=checkbox]")];
        const last = rows[rows.length - 1].getBoundingClientRect();
        const r = region.getBoundingClientRect();
        return { before, rows: rows.length, scrolls: region.scrollHeight > region.clientHeight, lastInside: last.bottom <= r.bottom + 1 && last.top >= r.top };
      });
      expect(leads.rows).toBe(60);
      expect(leads.scrolls).toBe(true);
      expect(leads.before).toBeGreaterThanOrEqual(200);
      expect(leads.lastInside).toBe(true);
    });

    test("terminal overlay opens on demand without moving the panels", async ({ page }) => {
      await openDashboard(page);
      const toggle = page.getByRole("button", { name: /No activity|Status Log|activity/ }).first();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("log")).toHaveCount(0);
      const before = await measure(page);

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("log")).toBeVisible();
      expect(await measure(page)).toEqual(before);

      await page.keyboard.press("Escape");
      await expect(page.getByRole("log")).toHaveCount(0);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");

      await toggle.click();
      await expect(page.getByRole("log")).toBeVisible();
      await page.mouse.click(vp.width / 2, vp.height - 40);
      await expect(page.getByRole("log")).toHaveCount(0);
      expect(await measure(page)).toEqual(before);
    });
  });
}
