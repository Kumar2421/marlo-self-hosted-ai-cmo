import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";
import { clsBetween, describeShifts, installVitals, pageNow, readVitals, watchProblems } from "./support/vitals.ts";

// Runtime quality gate for the mocked dashboard at 1536x730: layout stability (CLS),
// stable header/panel positions, a main-thread budget and a clean console/network.
// Numbers are measured against the Next dev server unless E2E_BASE_URL points at a
// production build; see e2e/README.md before changing a threshold.

const ANALYTICS_TABS = ["SEO", "Links", "Technical", "GEO", "Traffic", "Findings"];

const CLS_LIMIT = 0.1;

// Long tasks (> 50 ms) over load + leads populate + six Analytics tab switches.
// MEASURED_LONG_TASKS is the worst count seen over 11 runs (6 to 11, parallel workers included) on a dev server;
// the budget is that plus 30% headroom. Override with E2E_LONGTASK_BUDGET.
const MEASURED_LONG_TASKS = 11;
const LONG_TASK_BUDGET = Number(process.env.E2E_LONGTASK_BUDGET) || Math.ceil(MEASURED_LONG_TASKS * 1.3);

// Console/network noise we know about. Each entry needs a reason; an unknown message fails the test.
const KNOWN_PROBLEMS: { match: RegExp; reason: string }[] = [
  {
    match: /Failed to load animation data from URL: \/ghost-loader\.lottie\. AbortError/,
    reason: "The loading animation (dotlottie) aborts its own fetch when the loader unmounts; harmless, reported by the library as console.error.",
  },
];

// Requests the mocks answer with an error on purpose (none today). Tests that mock a 404
// add the URL pattern here so it is not reported as a failed request.
const MOCKED_404: RegExp[] = [];

test.use({ viewport: { width: 1536, height: 730 } });

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await installVitals(page);
});

type Phases = { load: [number, number]; leads: [number, number]; tabs: Record<string, [number, number]> };

/** Loads the dashboard, waits for the Leads panel to populate, then visits every Analytics tab. */
async function journey(page: Page): Promise<Phases> {
  const loadStart = 0;
  await page.goto("/dashboard");
  await expect(page.getByTestId("terminal-bar")).toBeVisible();
  const leadsStart = await pageNow(page);
  await expect(page.getByText("Very Long Lead Name Number 0").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const leadsEnd = await pageNow(page);

  const panel = page.locator("div[style*='grid-template-columns'] > *").nth(1);
  const tabs: Phases["tabs"] = {};
  for (const tab of ANALYTICS_TABS) {
    const from = await pageNow(page);
    await panel.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(800);
    tabs[tab] = [from, await pageNow(page)];
  }
  return { load: [loadStart, leadsStart], leads: [leadsStart, leadsEnd], tabs };
}

test("CLS stays under 0.1 through load, Leads populate and every Analytics tab", async ({ page }, testInfo) => {
  const phases = await journey(page);
  const v = await readVitals(page);

  const rows: [string, number][] = [
    ["load", clsBetween(v, ...phases.load)],
    ["leads populate", clsBetween(v, ...phases.leads)],
    ...Object.entries(phases.tabs).map(([t, r]) => [`tab ${t}`, clsBetween(v, ...r)] as [string, number]),
  ];
  const total = clsBetween(v);
  console.log(`[vitals] CLS total=${total.toFixed(4)} ${rows.map(([k, n]) => `${k}=${n.toFixed(4)}`).join(" ")} LCP=${Math.round(v.lcp ?? -1)}ms`);
  testInfo.annotations.push({ type: "cls", description: total.toFixed(4) });
  if (process.env.E2E_VITALS_DEBUG) console.log(`[vitals] shifts
${describeShifts(v)}`);

  const detail = describeShifts(v);
  for (const [name, cls] of rows) expect(cls, `CLS during ${name}\n${detail}`).toBeLessThan(CLS_LIMIT);
  expect(total, `total CLS\n${detail}`).toBeLessThan(CLS_LIMIT);
});

test("header and panels do not move after first paint", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("terminal-bar")).toBeVisible();

  // Sample every 250ms for 6s, starting the moment the header exists.
  const samples = await page.evaluate(
    () =>
      new Promise<{ header: number; panels: number[] }[]>((resolve) => {
        const out: { header: number; panels: number[] }[] = [];
        const read = () => {
          const bar = document.querySelector<HTMLElement>('[data-testid="terminal-bar"]');
          const grid = [...document.querySelectorAll<HTMLElement>("div")].find((d) => d.style.gridTemplateColumns);
          out.push({
            header: bar ? bar.getBoundingClientRect().top : NaN,
            panels: grid ? [...grid.children].map((p) => p.getBoundingClientRect().top) : [],
          });
        };
        read();
        const id = setInterval(() => {
          read();
          if (out.length >= 25) {
            clearInterval(id);
            resolve(out);
          }
        }, 250);
      }),
  );

  expect(samples).toHaveLength(25);
  const first = samples[0];
  expect(first.panels).toHaveLength(4);
  expect(first.header).not.toBeNaN();
  samples.forEach((s, i) => {
    expect(s.header, `header top at sample ${i}`).toBeCloseTo(first.header, 0);
    expect(s.panels, `panel tops at sample ${i}`).toHaveLength(4);
    s.panels.forEach((top, p) => expect(top, `panel ${p} top at sample ${i}`).toBeCloseTo(first.panels[p], 0));
  });
});

test("long tasks stay within budget", async ({ page }, testInfo) => {
  await journey(page);
  const v = await readVitals(page);
  const total = v.longTasks.reduce((sum, t) => sum + t.duration, 0);
  const longest = Math.max(0, ...v.longTasks.map((t) => t.duration));
  console.log(`[vitals] long tasks count=${v.longTasks.length} total=${Math.round(total)}ms longest=${Math.round(longest)}ms ${v.longTasks.map((t) => `${Math.round(t.duration)}@${Math.round(t.at)}`).join(" ")}`);
  testInfo.annotations.push({ type: "long-tasks", description: `${v.longTasks.length} (${Math.round(total)}ms)` });
  expect(v.longTasks.length, `budget ${LONG_TASK_BUDGET}; set E2E_LONGTASK_BUDGET to override`).toBeLessThanOrEqual(LONG_TASK_BUDGET);
});

test("no console errors, warnings or failed requests", async ({ page }) => {
  const problems = watchProblems(page);
  await journey(page);
  const unexpected = problems.filter((p) => !KNOWN_PROBLEMS.some((k) => k.match.test(p)) && !MOCKED_404.some((re) => re.test(p)));
  expect(unexpected, unexpected.join("\n")).toEqual([]);
});
