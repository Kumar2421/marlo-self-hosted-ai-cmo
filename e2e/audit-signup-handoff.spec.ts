import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// First-run dialog after the free audit: someone who came from /audit is asked only to confirm their site, not two
// unrelated questions, and their source is recorded. A normal first run still asks everything.

test.use({ viewport: { width: 1536, height: 730 } });

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
  await page.route("**/api/project", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ project: null, projects: [] }) })
      : route.fallback(),
  );
});

async function recordSettings(page: Page) {
  const saved: { key: string; value: string }[] = [];
  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "POST") saved.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  return saved;
}

test("from the audit: only the site is asked, prefilled, and the source is recorded", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("marlo:pending-audit-url", "https://acme-plumbing.test/"));
  const saved = await recordSettings(page);
  await page.goto("/dashboard");

  await expect(page.getByText("Let's grow your business")).toBeVisible();
  await expect(page.getByText("Confirm your website and Marlo will set it up.")).toBeVisible();
  await expect(page.getByPlaceholder("yourproduct.com")).toHaveValue("https://acme-plumbing.test/");
  await expect(page.getByText("How did you hear about us?")).toHaveCount(0);
  await expect(page.getByText("What best describes you?")).toHaveCount(0);

  await page.getByRole("button", { name: "Get started" }).click();
  await expect.poll(() => saved.length).toBeGreaterThan(0);
  expect(saved).toContainEqual({ key: "onboarding_source", value: "Free audit page" });
  expect(saved.some((s) => s.key === "personalization_role")).toBe(false);
});

test("a normal first run still asks where they heard about Marlo and what they do", async ({ page }) => {
  const saved = await recordSettings(page);
  await page.goto("/dashboard");

  await expect(page.getByText("How did you hear about us?")).toBeVisible();
  await expect(page.getByText("What best describes you?")).toBeVisible();
  await page.getByPlaceholder("yourproduct.com").fill("example.com");
  await page.getByRole("button", { name: "Get started" }).click();
  await expect.poll(() => saved.length).toBeGreaterThan(1);
  expect(saved.map((s) => s.key)).toEqual(expect.arrayContaining(["onboarding_source", "personalization_role"]));
});
