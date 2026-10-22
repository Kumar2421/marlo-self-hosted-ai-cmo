import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";
import { ALL_DONE, COMPLETE_FACTS, STEP_CALL, mockSetupApi, stateOf, type SetupMock } from "./support/setupResumeMock.ts";
import { SETUP_STEPS, type SetupStepKey } from "../lib/domain/project/setupState.ts";

// Resumable project setup (PR #174). Every provider, LLM, crawler and document route is mocked
// (e2e/support/setupResumeMock.ts); /api/project/setup runs the real setup service over an in-memory
// store, so the transition rules and the 10-minute stale cutoff are the production ones.

test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 1536, height: 730 } });

const SETUP = "/api/project/setup";
const card = (page: Page) => page.getByLabel("Finish setup");

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
});

/** Opens the Status Log drop-down (it is closed by default) and returns it. */
async function statusLog(page: Page) {
  const toggle = page.getByRole("button", { name: /Status Log|agent activity/i }).first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return page.getByRole("log", { name: "Agent activity" });
}

/** Step POSTs the app made, in order, as step keys. */
function stepsRun(mock: SetupMock): SetupStepKey[] {
  const byCall = new Map(SETUP_STEPS.map((k) => [STEP_CALL[k], k]));
  return mock.calls.flatMap((c) => (byCall.has(c) ? [byCall.get(c)!] : []));
}

function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function createFromOnboarding(page: Page) {
  await page.getByPlaceholder("yourproduct.com").fill("acme.example.test");
  await page.getByRole("button", { name: "Get started" }).click();
}

test("1. creating a project records every setup step and the Finish-setup card never lingers", async ({ page }) => {
  const errors = pageErrors(page);
  const mock = await mockSetupApi(page, { project: false });
  await page.goto("/dashboard");
  await createFromOnboarding(page);

  // The row ends with every step done (competitors found, so both competitor documents run).
  await expect.poll(() => SETUP_STEPS.every((k) => mock.state()?.steps[k].status === "done"), { timeout: 30_000 }).toBe(true);
  expect(mock.state()?.finishedAt).not.toBeNull();

  // Each step went running -> done through PUT /api/project/setup, in setup order.
  for (const k of SETUP_STEPS) {
    const seq = mock.puts.filter((p) => p.step === k).map((p) => p.status);
    expect(seq, k).toEqual(["running", "done"]);
  }
  const firstRunning = SETUP_STEPS.map((k) => mock.puts.findIndex((p) => p.step === k && p.status === "running"));
  expect(firstRunning).toEqual([...firstRunning].sort((a, b) => a - b));
  expect(stepsRun(mock)).toEqual([...SETUP_STEPS]);

  await expect(page.getByRole("button", { name: "Get started" })).toBeHidden();
  await expect(card(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("2. reload mid-setup resumes only the missing and interrupted steps, in order", async ({ page }) => {
  const mock = await mockSetupApi(page, {
    project: true,
    state: stateOf({
      audit: "done",
      description: "done",
      competitors: "done",
      leads: "done",
      "product-info": "done",
      "marketing-strategy": { status: "running", ageMs: 11 * 60_000 }, // tab closed mid-step, 11 min ago
    }),
  });
  await page.goto("/dashboard");

  await expect.poll(() => SETUP_STEPS.every((k) => mock.state()?.steps[k].status === "done"), { timeout: 30_000 }).toBe(true);

  const log = await statusLog(page);
  await expect(log).toContainText("Resuming setup (5 of 10 done)...");

  // Only the 5 unfinished steps ran, once each, in order; the done ones were not requested again.
  expect(stepsRun(mock)).toEqual(["marketing-strategy", "competitor-analysis", "competitor-comparison", "content-strategy", "design-guide"]);
  for (const k of ["audit", "description", "competitors", "leads", "product-info"] as const) expect(mock.count(STEP_CALL[k]), k).toBe(0);
  for (const k of ["marketing-strategy", "competitor-analysis", "competitor-comparison", "content-strategy", "design-guide"] as const) {
    expect(mock.count(STEP_CALL[k]), k).toBe(1);
  }
  expect(mock.count("POST /api/project")).toBe(0); // nothing re-created
  await expect(card(page)).toHaveCount(0);
});

test("3. a failed step is not retried automatically; Retry runs it and its dependents", async ({ page }) => {
  const mock = await mockSetupApi(page, {
    project: true,
    state: stateOf({
      ...ALL_DONE,
      "marketing-strategy": { status: "failed", error: "generation failed" },
      "design-guide": "pending", // written from Marketing Strategy, so it waits
    }),
  });
  await page.goto("/dashboard");

  await expect(card(page)).toBeVisible();
  const rows = card(page).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Marketing Strategy");
  await expect(rows.nth(0)).toContainText("generation failed");
  await expect(rows.nth(1)).toContainText("Design Guide");
  await expect(rows.nth(1)).toContainText("Waiting on Marketing Strategy");
  const retry = card(page).getByRole("button", { name: "Retry" });
  await expect(retry).toHaveCount(1); // the waiting Design Guide has nothing to retry yet

  // Give an (unwanted) auto-resume time to show itself: the page has loaded and read the state.
  await expect.poll(() => mock.count(`GET ${SETUP}`)).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect(stepsRun(mock)).toEqual([]);
  expect(mock.state()?.steps["marketing-strategy"].status).toBe("failed");

  await retry.click();
  await expect.poll(() => SETUP_STEPS.every((k) => mock.state()?.steps[k].status === "done"), { timeout: 30_000 }).toBe(true);
  expect(stepsRun(mock)).toEqual(["marketing-strategy", "design-guide"]);
  await expect(card(page)).toHaveCount(0);
  await expect(await statusLog(page)).toContainText("Retrying Marketing Strategy...");
});

test("4. a step running in another tab is never run here; this tab polls, then finishes the rest", async ({ page }) => {
  const mock = await mockSetupApi(page, {
    project: true,
    state: stateOf({
      audit: "done",
      description: "done",
      competitors: "done",
      leads: "done",
      "product-info": { status: "running", ageMs: 30_000 }, // another tab claimed it 30s ago
    }),
  });
  await page.goto("/dashboard");

  await expect(await statusLog(page)).toContainText("Setup is running in another tab");
  // No Finish-setup card while another tab is working.
  await expect(card(page)).toHaveCount(0);

  // Polling: GET /api/project/setup keeps being called (5s interval); no step route is.
  const before = mock.count(`GET ${SETUP}`);
  await expect.poll(() => mock.count(`GET ${SETUP}`) - before, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  expect(stepsRun(mock)).toEqual([]);
  expect(mock.puts).toEqual([]);

  // The other tab finishes its step and goes away: this tab picks up the remaining steps.
  mock.setState(
    stateOf({ audit: "done", description: "done", competitors: "done", leads: "done", "product-info": "done" }),
  );
  await expect.poll(() => SETUP_STEPS.every((k) => mock.state()?.steps[k].status === "done"), { timeout: 30_000 }).toBe(true);
  expect(stepsRun(mock)).toEqual(["marketing-strategy", "competitor-analysis", "competitor-comparison", "content-strategy", "design-guide"]);
  await expect(card(page)).toHaveCount(0);
});

test("5. a legacy project with no state row but complete documents is not resumed and shows no card", async ({ page }) => {
  const mock = await mockSetupApi(page, { project: true, state: null, facts: COMPLETE_FACTS });
  await page.goto("/dashboard");

  await expect.poll(() => mock.count(`GET ${SETUP}`)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Documents" })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(stepsRun(mock)).toEqual([]);
  expect(mock.puts).toEqual([]);
  await expect(card(page)).toHaveCount(0);
  // The derived row was stored lazily and reads as complete and never started.
  expect(mock.state()?.startedAt).toBeNull();
  expect(mock.state()?.finishedAt).not.toBeNull();
});

test("6a. when the setup table is missing (500) nothing resumes, nothing crashes, the dashboard works", async ({ page }) => {
  const errors = pageErrors(page);
  const mock = await mockSetupApi(page, { project: true, setupBroken: true });
  await page.goto("/dashboard");

  await expect.poll(() => mock.count(`GET ${SETUP}`)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Documents" })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(stepsRun(mock)).toEqual([]);
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId("terminal-bar")).toBeVisible();
  // The rest of the dashboard still answers: open a document.
  await page.getByRole("button", { name: /Product Information/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Product Information" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("6b. when the setup table is missing (500) creating a project still runs every step", async ({ page }) => {
  const errors = pageErrors(page);
  const mock = await mockSetupApi(page, { project: false, setupBroken: true });
  await page.goto("/dashboard");
  await createFromOnboarding(page);

  await expect.poll(() => stepsRun(mock).length, { timeout: 30_000 }).toBe(SETUP_STEPS.length);
  expect(stepsRun(mock)).toEqual([...SETUP_STEPS]);
  await expect(page.getByRole("button", { name: "Get started" })).toBeHidden();
  await expect(card(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
