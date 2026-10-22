import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, signIn } from "./support/dashboardMock.ts";

// Layout regression for the signed-in dashboard: the page must never scroll, the
// four panels must end at the viewport bottom, and the header must stay compact.
// Tablet widths (768-1099px) use the two-pane compact shell: the panes end at the
// bottom tab bar, and no header or tab bar may run past its panel.
// Server auth is satisfied by the fake Supabase server (see support/fakeSupabaseServer.ts).

const VIEWPORTS = [
  { width: 1888, height: 867 },
  { width: 1536, height: 730 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1100, height: 800 }, // narrowest four-column layout: 286px panels
];

const TABLET_VIEWPORTS = [
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 900, height: 1000 },
  { width: 1024, height: 768 },
  { width: 1099, height: 800 },
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

/** Visible panels: the four grid columns on desktop, the two shown tabpanels on tablet. */
async function panelBoxes(page: Page) {
  return page.evaluate(() => {
    const shown = [...document.querySelectorAll<HTMLElement>('section[role="tabpanel"]:not([hidden])')];
    const grid = [...document.querySelectorAll<HTMLElement>("div")].find((d) => d.style.gridTemplateColumns);
    const panels = shown.length ? shown : [...(grid?.children ?? [])];
    return panels.map((p) => {
      const r = p.getBoundingClientRect();
      return { id: p.id, bottom: Math.round(r.bottom), right: Math.round(r.right), width: Math.round(r.width) };
    });
  });
}

/** Header/tab-bar children that run past their panel, and tab bars that have to scroll. */
async function clippedHeaders(page: Page) {
  return page.evaluate(() => {
    const shown = [...document.querySelectorAll<HTMLElement>('section[role="tabpanel"]:not([hidden])')];
    const grid = [...document.querySelectorAll<HTMLElement>("div")].find((d) => d.style.gridTemplateColumns);
    const panels = (shown.length ? shown : [...(grid?.children ?? [])]) as HTMLElement[];
    const bad: string[] = [];
    for (const p of panels) {
      const pr = p.getBoundingClientRect();
      for (const el of p.querySelectorAll<HTMLElement>("*")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const inHeader = r.top < pr.top + 48;
        const inTabs = !!el.closest("[role=tablist]");
        if ((inHeader || inTabs) && r.right > pr.right + 0.5) {
          bad.push(`${p.id || "panel"} ${el.tagName}[${(el.textContent ?? "").trim().slice(0, 20)}] right=${Math.round(r.right)} > ${Math.round(pr.right)}`);
        }
      }
      for (const t of p.querySelectorAll<HTMLElement>("[role=tablist]")) {
        if (t.scrollWidth > t.clientWidth + 1) bad.push(`${p.id || "panel"} tab bar [${(t.textContent ?? "").trim().slice(0, 30)}] scrolls ${t.scrollWidth}/${t.clientWidth}`);
      }
    }
    return bad;
  });
}

/** Leads defaults to "With email"; lead 0 has no address, so switch to All to see every row. */
async function showAllLeads(page: Page) {
  await expect(page.getByRole("tab", { name: /^With email/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /^All/ }).click();
  await expect(page.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Very Long Lead Name Number 0").first()).toBeVisible();
}

async function openDashboard(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByTestId("terminal-bar")).toBeVisible();
  await expect(page.getByRole("tab", { name: /^With email/ })).toBeVisible();
  await showAllLeads(page);
  // Let panel skeletons and late fetches settle before measuring.
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async ({ page, context, baseURL }) => {
  // The Next dev-only indicator badge sits over the bottom tab bar and eats clicks.
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
      expect(await clippedHeaders(page)).toEqual([]);
    });

    test("Leads results keep at least 200px with 60 leads and the profile form open", async ({ page }) => {
      await openDashboard(page);
      // The profile starts as a one-line summary once leads exist; expand it so the full form is open.
      await page.getByTestId("lead-profile-summary").getByRole("button").first().click();
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

for (const vp of TABLET_VIEWPORTS) {
  test.describe(`tablet ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test("two panes fill the space above the tab bar with no overflow or clipped headers", async ({ page }) => {
      await openDashboard(page);
      for (const pair of [["Context", "Leads"], ["Analytics", "Chat"]]) {
        await page.getByRole("tab", { name: pair[0], exact: true }).click();
        await page.getByRole("tab", { name: pair[1], exact: true }).click();
        await page.waitForLoadState("networkidle");
        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const nav = document.querySelector('nav[aria-label="Dashboard sections"]')!.getBoundingClientRect();
          return {
            vh: window.innerHeight,
            scrollH: de.scrollHeight,
            scrollW: de.scrollWidth,
            clientW: de.clientWidth,
            navTop: Math.round(nav.top),
            navBottom: Math.round(nav.bottom),
            header: document.querySelector('[data-testid="terminal-bar"]')!.getBoundingClientRect().height,
          };
        });
        expect(m.scrollH).toBeLessThanOrEqual(m.vh);
        expect(m.scrollW).toBeLessThanOrEqual(m.clientW);
        expect(m.navBottom).toBe(m.vh);
        expect(m.header).toBeLessThanOrEqual(56);
        const panels = await panelBoxes(page);
        expect(panels).toHaveLength(2);
        for (const b of panels) expect(b.bottom).toBe(m.navTop);
        expect(panels[1].right).toBe(m.clientW);
        expect(await clippedHeaders(page)).toEqual([]);
      }
    });
  });
}

// The narrowest four-column width (1100px, 286px panels) is where the Leads cards used to wrap
// one word per line and the profile summary shrank to "F - Edit".
test.describe("narrow Leads panel stays readable", () => {
  for (const vp of [{ width: 1100, height: 800 }, { width: 820, height: 1180 }]) {
    test(`${vp.width}px`, async ({ page }) => {
      await page.setViewportSize(vp);
      await openDashboard(page);
      const m = await page.evaluate(() => {
        const grid = [...document.querySelectorAll<HTMLElement>("div")].find((d) => d.style.gridTemplateColumns);
        const panel = document.getElementById("dash-panel-agents") ?? (grid!.children[2] as HTMLElement);
        const line = (el: Element) => parseFloat(getComputedStyle(el).lineHeight) || 16;
        const summary = panel.querySelector<HTMLElement>('[data-testid="lead-profile-summary"]')!;
        const summaryText = summary.querySelector<HTMLElement>("button span")!;
        const gmailHeading = [...panel.querySelectorAll<HTMLElement>("div")].find((d) => d.textContent === "Connect Gmail to email your leads");
        const connect = [...panel.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === "Connect Gmail");
        const card = connect?.closest<HTMLElement>("div.rounded-xl");
        const tabs = [...panel.querySelectorAll<HTMLElement>("button")].filter((b) => /^(People|Local Business)/.test(b.textContent ?? ""));
        return {
          summaryLines: Math.round(summaryText.getBoundingClientRect().height / line(summaryText)),
          summaryClipped: summaryText.scrollHeight > summaryText.clientHeight + 1,
          gmailHeadingWidth: Math.round(gmailHeading?.getBoundingClientRect().width ?? 0),
          gmailHeadingLines: gmailHeading ? Math.round(gmailHeading.getBoundingClientRect().height / line(gmailHeading)) : 0,
          connectInCard: !!card && connect!.getBoundingClientRect().right <= card.getBoundingClientRect().right + 0.5,
          modeTabHeights: tabs.map((t) => Math.round(t.getBoundingClientRect().height)),
        };
      });
      expect(m.summaryLines).toBeLessThanOrEqual(2);
      expect(m.summaryClipped).toBe(false);
      expect(m.gmailHeadingWidth).toBeGreaterThanOrEqual(150);
      expect(m.gmailHeadingLines).toBeLessThanOrEqual(3);
      expect(m.connectInCard).toBe(true);
      // People / Local Business stay on one line (about 30px tall).
      for (const h of m.modeTabHeights) expect(h).toBeLessThanOrEqual(34);
    });
  }
});
