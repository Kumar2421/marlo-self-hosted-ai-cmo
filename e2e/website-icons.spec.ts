import { expect, test } from "@playwright/test";
import { mockDashboardApi, signIn } from "./support/dashboardMock.ts";

// Competitor chips must never turn a bad host string into a failing /api/favicon call.
// The favicon mock behaves like the real route: 400 for anything that is not an http(s) URL.

const NOW = "2026-01-01T00:00:00Z";
const COMPETITORS = [
  { id: "c1", url: "https://rival-one.example.test", created_at: NOW },
  { id: "c2", url: "rival-one.example.test", created_at: NOW },
  { id: "c3", url: "Marlo", created_at: NOW },
  { id: "c4", url: "Marlo.mlforge.in", created_at: NOW },
  { id: "c5", url: "my competitor", created_at: NOW },
];

test("bad competitor hosts never hit /api/favicon with a 400, and each host is requested once", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);

  const requests: string[] = [];
  const statuses: number[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  // Registered after the generic mock, so these win.
  await page.route("**/api/favicon**", (route) => {
    const raw = new URL(route.request().url()).searchParams.get("url") ?? "";
    requests.push(raw);
    let valid = true;
    try {
      valid = /^https?:$/.test(new URL(raw).protocol);
    } catch {
      valid = false;
    }
    const status = valid ? 200 : 400;
    statuses.push(status);
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ favicon: null }) });
  });
  await page.route("**/api/project/data", (route) => {
    const empty = ["project_documents", "link_checks", "geo_checks", "site_crawls", "traffic_checks", "code_fixes", "seo_audits", "findings", "leads"];
    const data: Record<string, unknown[]> = Object.fromEntries(empty.map((k) => [k, []]));
    data.project_competitors = COMPETITORS;
    const project = { id: "11111111-1111-4111-8111-111111111111", name: "Acme Invoice", url: "https://acme.example.test", updated_at: NOW };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ project, projectId: project.id, data }) });
  });

  await page.goto("/dashboard");
  await expect(page.getByTestId("terminal-bar")).toBeVisible();
  await expect(page.getByText("Marlo.mlforge.in").first()).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(statuses.filter((s) => s === 400)).toEqual([]);
  expect(requests.length).toBe(2); // rival-one.example.test (deduped across 2 chips) and marlo.mlforge.in
  expect(consoleErrors.filter((e) => /favicon|400/i.test(e))).toEqual([]);
  // Bad values still render a chip (letter/globe fallback) instead of disappearing.
  await expect(page.getByText("Marlo", { exact: true })).toBeVisible();
  await expect(page.getByText("my competitor")).toBeVisible();
});
