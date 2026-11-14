import { expect, test, type Page } from "@playwright/test";

// The marketing site's audit forms send what people type ("example.com"). The audit page must run on it, and say so
// when what arrived is not a website address, instead of showing an empty form with no explanation.

test.use({ viewport: { width: 1280, height: 900 } });

async function mockAudit(page: Page) {
  const bodies: { url: string }[] = [];
  await page.route("**/api/public/audit/events", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.route("**/api/public/audit", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    bodies.push(r.request().postDataJSON());
    return r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ url: "https://example.com/", findings: [], summary: { totalFindings: 0, critical: 0, warnings: 0 }, technical: { onPageScore: 100, status: 200, redirectCount: 0 }, report: null }),
    });
  });
  return bodies;
}

test("a link with a bare domain runs the audit on it", async ({ page }) => {
  const bodies = await mockAudit(page);
  await page.goto("/audit?url=example.com&ref=seo-tools");
  await expect(page.getByTestId("audit-result")).toBeVisible();
  expect(bodies).toEqual([{ url: "https://example.com/" }]);
});

test("typing a bare domain in the box runs the audit on it", async ({ page }) => {
  const bodies = await mockAudit(page);
  await page.goto("/audit");
  await page.getByPlaceholder("yourwebsite.com").fill("www.example.com/pricing");
  await page.getByRole("button", { name: "Run free audit" }).click();
  await expect(page.getByTestId("audit-result")).toBeVisible();
  expect(bodies).toEqual([{ url: "https://www.example.com/pricing" }]);
});

test("something that is not a website address is explained, and nothing is sent", async ({ page }) => {
  const bodies = await mockAudit(page);
  await page.goto("/audit");
  await page.getByPlaceholder("yourwebsite.com").fill("hello");
  await page.getByRole("button", { name: "Run free audit" }).click();
  await expect(page.getByText("Enter a website address, like example.com.")).toBeVisible();
  expect(bodies).toEqual([]);
});

test("a link carrying junk says so instead of showing an unexplained empty form", async ({ page }) => {
  const bodies = await mockAudit(page);
  await page.goto("/audit?url=not%20a%20site");
  await expect(page.getByText("That does not look like a website address")).toBeVisible();
  await expect(page.getByPlaceholder("yourwebsite.com")).toHaveValue("");
  expect(bodies).toEqual([]);
});
