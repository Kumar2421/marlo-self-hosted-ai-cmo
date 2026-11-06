import { expect, test } from "@playwright/test";
import { mockDashboardApi, serveLottieWasmLocally, signIn } from "./support/dashboardMock.ts";

// The lead profile wizard with an Offer Model: Marlo shows what it read on the site with the quote behind each
// answer, says so honestly when the site did not say, and lets a buyer with no job title be confirmed.
// Every API is mocked; nothing here calls a model or the network.

test.describe.configure({ timeout: 60_000 });
test.use({ viewport: { width: 1536, height: 900 } });

const SUGGESTION = {
  version: 1,
  roles: [],
  industries: ["small clinics and retail shops"],
  sizes: [],
  locations: [],
  problem: "Teams lose deals to spreadsheets.",
  exclude: [],
  webRelated: false,
  confirmedAt: null,
};

const OFFER = {
  version: 1,
  archetype: "service",
  sells: "custom software and CRM",
  whoPays: "small clinics and retail shops",
  clientKind: "companies",
  roles: [],
  industries: ["small clinics and retail shops"],
  locations: [],
  problem: "Teams lose deals to spreadsheets.",
  webRelated: false,
  evidence: {
    sells: { quote: "builds custom software and CRM", url: "https://acme.example.test/" },
    whoPays: { quote: "for small clinics and retail shops in Tamil Nadu", url: "https://acme.example.test/pricing" },
    industries: { quote: "small clinics and retail shops", url: "https://acme.example.test/" },
    problem: { quote: "Teams lose deals to spreadsheets.", url: "javascript:alert(1)" },
  },
  sources: ["https://acme.example.test/", "https://acme.example.test/pricing"],
  derivedAt: "2026-11-05T00:00:00Z",
};

test.beforeEach(async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!);
  await mockDashboardApi(page);
  await serveLottieWasmLocally(page);
});

async function mockProfile(page: import("@playwright/test").Page, offer: unknown) {
  const puts: { profile: Record<string, unknown>; confirm: boolean }[] = [];
  // Registered after mockDashboardApi, so it wins for this one path.
  await page.route("**/api/agents/leads/profile", (route) => {
    if (route.request().method() === "PUT") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      puts.push(body);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: { ...body.profile, confirmedAt: "2026-11-05T00:00:00Z" } }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: null, suggestion: SUGGESTION, offer }) });
  });
  return puts;
}

test("the wizard shows what Marlo read with its quotes, and says so when the site did not say", async ({ page }) => {
  await mockProfile(page, OFFER);
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "Review who buys from you" }).click();
  const understood = page.getByTestId("offer-understood");
  await expect(understood).toBeVisible();
  await expect(understood).toContainText("A service business");
  await expect(understood).toContainText("custom software and CRM");
  await expect(page.getByTestId("evidence-whoPays")).toContainText("for small clinics and retail shops in Tamil Nadu");

  // The site named no job title: the field says so instead of looking filled in.
  await expect(page.getByText("Not found on your site. Add it if you know it.").first()).toBeVisible();
  await expect(page.getByTestId("evidence-roles")).toHaveCount(0);

  // A real page link is offered; a model-supplied javascript: URL is never rendered as a link.
  await expect(page.getByTestId("evidence-whoPays").getByRole("link", { name: "Open the page" })).toHaveAttribute("href", "https://acme.example.test/pricing");
});

test("a buyer with no job title can go through all four steps and be confirmed", async ({ page }) => {
  const puts = await mockProfile(page, OFFER);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Review who buys from you" }).click();

  const next = page.getByRole("dialog").getByRole("button", { name: "Next", exact: true });
  await expect(next).toBeEnabled(); // step 1: job titles are optional
  await next.click();
  await expect(page.getByText("What kind of companies or customers?")).toBeVisible();
  await expect(page.getByTestId("evidence-industries")).toContainText("small clinics and retail shops");
  await expect(next).toBeEnabled(); // the suggested kind of customer is enough
  await next.click();
  await expect(page.getByTestId("evidence-problem")).toBeVisible();
  await expect(page.getByTestId("evidence-problem").getByRole("link")).toHaveCount(0); // javascript: URL is not a link
  await next.click();

  await page.getByRole("button", { name: "Confirm and find leads" }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].confirm).toBe(true);
  expect(puts[0].profile.roles).toEqual([]);
  expect(puts[0].profile.industries).toEqual(["small clinics and retail shops"]);
});

test("without an offer model the wizard still works from the suggestion, with no evidence lines", async ({ page }) => {
  await mockProfile(page, null);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Set up lead profile" }).click();
  await expect(page.getByText("Who do you want to reach?")).toBeVisible();
  await expect(page.getByTestId("offer-understood")).toHaveCount(0);
  await expect(page.getByText("Not found on your site. Add it if you know it.")).toHaveCount(0);
});

test("an empty profile cannot get past the kind-of-customer step", async ({ page }) => {
  await page.route("**/api/agents/leads/profile", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: null, suggestion: { ...SUGGESTION, industries: [], problem: "" }, offer: null }) }),
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Set up lead profile" }).click();
  const next = page.getByRole("dialog").getByRole("button", { name: "Next", exact: true });
  await next.click(); // step 1 -> 2 is allowed
  await expect(next).toBeDisabled(); // nothing on step 2 yet
});
