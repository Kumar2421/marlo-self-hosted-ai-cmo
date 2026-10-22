import { expect, test } from "@playwright/test";
import { mockDashboardApi, signIn } from "./support/dashboardMock.ts";

// The comparison's first card is the user's own project, never the hardcoded "Marlo".

const NOW = "2026-01-01T00:00:00Z";
const PROJECT = { id: "11111111-1111-4111-8111-111111111111", name: "Acme Invoice", url: "https://acme.example.test", updated_at: NOW };
const MARKDOWN = [
  "# Competitor Comparison",
  "Generated: 2026-01-01",
  "",
  "## Competitors at a Glance",
  "",
  "### Rival.test",
  "**URL:** https://rival.test",
  "**Starting Price:** $10/month",
  "**Key Features:**",
  "- Lead tracking",
  "",
  "## Analysis",
  "Extracted.",
].join("\n");

test("comparison panel shows the project name, not Marlo, and no 'Why Marlo wins'", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await page.route("**/api/project/data", (route) => {
    const empty = ["project_documents", "link_checks", "geo_checks", "site_crawls", "traffic_checks", "code_fixes", "seo_audits", "findings", "leads"];
    const data: Record<string, unknown[]> = Object.fromEntries(empty.map((k) => [k, []]));
    data.project_competitors = [{ id: "c1", url: "https://rival.test", created_at: NOW }];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ project: PROJECT, projectId: PROJECT.id, data }) });
  });
  await page.route("**/api/project/documents/competitor-comparison**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ document: { content: MARKDOWN } }) }),
  );

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "View Comparison Table" }).click();
  const own = page.getByTestId("own-product-card");
  await expect(own).toBeVisible();
  await expect(own.getByRole("heading", { name: "Acme Invoice" })).toBeVisible();
  // Older saved comparison (no own data): honest state, no invented feature list.
  await expect(own).toContainText("Regenerate to compare your own product");
  await expect(page.getByText("Why Marlo wins")).toHaveCount(0);
  await expect(own.getByText("Marlo")).toHaveCount(0);
});
