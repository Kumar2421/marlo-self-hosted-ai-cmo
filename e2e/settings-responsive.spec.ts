import { expect, test, type Page } from "@playwright/test";
import { mockSettingsApi, signIn } from "./support/settingsMock.ts";

// Responsive regression for every settings page: no horizontal page overflow, nav
// reachable (top bar below md, sidebar from md up), and comfortable tap targets.
// Server auth is satisfied by the fake Supabase server (see support/fakeSupabaseServer.ts).

const ROUTES = [
  "account",
  "agents",
  "api-credentials",
  "credits",
  "integrations",
  "llm-providers",
  "notifications",
  "personalization",
  "websites",
].map((r) => `/settings/${r}`);

const VIEWPORTS = [
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1280, height: 800, mobile: false },
];

type Overflow = { scrollW: number; innerW: number; wide: string[] };

async function measure(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const innerW = window.innerWidth;
    // An element is intentionally scrollable when an ancestor (or itself) clips/scrolls horizontally.
    const insideScroller = (el: Element) => {
      for (let n: Element | null = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      }
      return false;
    };
    const wide: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= innerW + 1) continue;
      if (getComputedStyle(el).position === "fixed" || insideScroller(el)) continue;
      wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
    }
    return { scrollW: document.documentElement.scrollWidth, innerW, wide: wide.slice(0, 5) };
  });
}

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockSettingsApi(page);
});

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const route of ROUTES) {
      test(`${route} fits the viewport`, async ({ page }) => {
        await page.goto(route);
        await expect(page.getByRole("heading").first()).toBeVisible();
        await page.waitForLoadState("networkidle");

        const m = await measure(page);
        console.log(`MEASURE ${vp.width} ${route} scrollWidth=${m.scrollW}`);
        if (process.env.E2E_DEBUG) console.log(JSON.stringify(m.wide));
        expect(m.scrollW, `scrollWidth ${m.scrollW} > innerWidth ${m.innerW}`).toBeLessThanOrEqual(m.innerW);
        expect(m.wide, "elements wider than the viewport").toEqual([]);

        const bar = page.getByTestId("settings-mobile-bar");
        const sidebar = page.getByTestId("settings-sidebar");
        const active = (vp.mobile ? bar : sidebar).locator('a[aria-current="page"]');
        if (vp.mobile) {
          await expect(bar).toBeVisible();
          await expect(sidebar).toBeHidden();
          await expect(bar.getByRole("button", { name: "Back to dashboard" })).toBeVisible();
        } else {
          await expect(sidebar).toBeVisible();
          await expect(bar).toBeHidden();
        }

        // Every nav link is reachable (scroll into view works inside the pill list) and tall enough to tap.
        const nav = vp.mobile ? bar : sidebar;
        const links = nav.getByRole("link");
        const count = await links.count();
        expect(count).toBeGreaterThanOrEqual(8);
        for (let i = 0; i < count; i++) {
          const box = await links.nth(i).boundingBox();
          expect(box!.height, `nav link ${i} height`).toBeGreaterThanOrEqual(36);
        }
        // The current page may be hidden by the optional platform filter only for api-credentials.
        if ((await active.count()) > 0) {
          await active.scrollIntoViewIfNeeded();
          await expect(active).toBeVisible();
        } else {
          expect(route).toMatch(/api-credentials/);
        }
      });
    }

    if (vp.mobile) {
      test("mobile nav navigates between pages", async ({ page }) => {
        await page.goto("/settings/account");
        const bar = page.getByTestId("settings-mobile-bar");
        await bar.getByRole("link", { name: "Notifications" }).click();
        await expect(page).toHaveURL(/\/settings\/notifications$/);
        await expect(page.getByTestId("settings-mobile-bar").locator('a[aria-current="page"]')).toHaveText(/Notifications/);
      });
    }
  });
}
