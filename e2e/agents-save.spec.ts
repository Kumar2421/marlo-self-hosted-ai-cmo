import { expect, test, type Page } from "@playwright/test";
import { mockSettingsApi, signIn } from "./support/settingsMock.ts";

// Settings > Agents: edits stay in a local draft until "Save changes" is pressed.
// All endpoints are mocked; the saved settings live in this file's closure.

type Saved = { version: 1; subreddits: string[]; keywords: string[]; country: "global" | "us" };

async function setup(page: Page, opts: { failPut?: boolean; putDelayMs?: number } = {}) {
  await mockSettingsApi(page);
  let stored: Saved = { version: 1, subreddits: ["r/startups"], keywords: ["lead gen"], country: "global" };
  const puts: unknown[] = [];
  await page.route("**/api/agents/reddit/settings", async (route) => {
    const req = route.request();
    if (req.method() === "PUT") {
      puts.push(req.postDataJSON());
      if (opts.putDelayMs) await new Promise((r) => setTimeout(r, opts.putDelayMs));
      if (opts.failPut) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
      stored = req.postDataJSON().settings;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ settings: stored }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ settings: stored }) });
  });
  return { puts };
}

test.beforeEach(async ({ context, baseURL }) => {
  await signIn(context, baseURL!);
});

// The app can keep a hidden duplicate of a settings page alive, so only visible elements are used.
const SAVED_RE = /^\s*Saved\s*$/;
const save = (page: Page) => page.getByRole("button", { name: /^(Save changes|Saving\.\.\.)$/ }).locator("visible=true").first();
const discard = (page: Page) => page.getByRole("button", { name: "Discard" }).locator("visible=true").first();
const region = (page: Page) => page.locator("#reddit-region");

async function open(page: Page) {
  await page.goto("/settings/agents");
  await expect(page.getByRole("heading", { name: "Agents", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove r/startups" })).toBeVisible();
}

test("Save is disabled until something changes, and shows the accurate hint", async ({ page }) => {
  await setup(page);
  await open(page);
  await expect(save(page)).toBeDisabled();
  await expect(discard(page)).toBeDisabled();
  await expect(page.getByText("Priority subreddits, keywords and region apply to your next Reddit run.")).toBeVisible();
  await region(page).selectOption("us");
  await expect(save(page)).toBeEnabled();
  await expect(discard(page)).toBeEnabled();
});

test("changing a value back to the saved one disables Save again", async ({ page }) => {
  await setup(page);
  await open(page);
  const input = page.getByRole("textbox", { name: "Search keywords", exact: true });
  await input.fill("growth");
  await input.press("Enter");
  await expect(save(page)).toBeEnabled();
  await page.getByRole("button", { name: "Remove growth" }).click();
  await expect(save(page)).toBeDisabled();
});

test("Save sends one PUT with the draft, then confirms with Saved", async ({ page }) => {
  const { puts } = await setup(page, { putDelayMs: 400 });
  await open(page);
  await region(page).selectOption("us");
  const subs = page.getByRole("textbox", { name: "Priority subreddits", exact: true });
  await subs.fill("r/SaaS");
  await subs.press("Enter");
  await expect(page.getByRole("button", { name: "Remove r/SaaS" })).toBeVisible();
  expect(puts).toHaveLength(0); // nothing is sent while editing

  await save(page).click();
  await expect(page.getByRole("button", { name: "Saving..." }).locator("visible=true").first()).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: SAVED_RE }).locator("visible=true").first()).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(puts[0]).toEqual({ settings: { version: 1, subreddits: ["r/startups", "r/SaaS"], keywords: ["lead gen"], country: "us" } });
  await expect(save(page)).toBeDisabled();
  await expect(region(page)).toHaveValue("us");
  // The confirmation fades out on its own.
  await expect(page.getByRole("status").filter({ hasText: SAVED_RE })).toHaveCount(0, { timeout: 8000 });
});

test("a failed save keeps the draft, shows the error and allows a retry", async ({ page }) => {
  const { puts } = await setup(page, { failPut: true });
  await open(page);
  await region(page).selectOption("us");
  await save(page).click();
  await expect(page.getByText("Could not save. Your changes were kept so you can try again.")).toBeVisible();
  expect(puts).toHaveLength(1);
  await expect(region(page)).toHaveValue("us"); // draft survived
  await expect(save(page)).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: SAVED_RE })).toHaveCount(0);
  await save(page).click();
  await expect.poll(() => puts.length).toBe(2);
});

test("Discard reverts the draft", async ({ page }) => {
  const { puts } = await setup(page);
  await open(page);
  await region(page).selectOption("us");
  const kw = page.getByRole("textbox", { name: "Search keywords", exact: true });
  await kw.fill("growth");
  await kw.press("Enter");
  await page.getByRole("button", { name: "Remove r/startups" }).click();
  await discard(page).click();
  await expect(region(page)).toHaveValue("global");
  await expect(page.getByRole("button", { name: "Remove r/startups" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove growth" })).toHaveCount(0);
  await expect(save(page)).toBeDisabled();
  expect(puts).toHaveLength(0);
});

test("invalid chips are rejected by the domain rules and do not enable Save", async ({ page }) => {
  await setup(page);
  await open(page);
  const subs = page.getByRole("textbox", { name: "Priority subreddits", exact: true });
  await subs.fill("not valid!");
  await subs.press("Enter");
  await expect(page.locator("#reddit-subreddits-error")).toContainText("valid subreddit");
  await expect(save(page)).toBeDisabled();
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("Save is reachable at the bottom of the card with a 44px target", async ({ page }) => {
    await setup(page);
    await open(page);
    await region(page).selectOption("us");
    const footer = page.getByTestId("reddit-save-bar-footer");
    await footer.scrollIntoViewIfNeeded();
    const btn = footer.getByRole("button", { name: "Save changes" });
    await expect(btn).toBeEnabled();
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
