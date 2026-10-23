import type { BrowserContext, Page, Route } from "@playwright/test";

/** Same default as playwright.config.ts; the cookie name is derived from this host. */
export const SUPABASE_URL = process.env.E2E_SUPABASE_URL || "http://localhost:54329";

const FAKE_USER = {
  id: "00000000-0000-4000-8000-0000000000e2",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e-user@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const LONG = "https://www.a-very-long-domain-name-for-layout-testing.example.test/some/very/long/path/with/many/segments/index.html";

const PROJECT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme Invoice With A Deliberately Long Project Name For Layout Testing",
  category: "SaaS",
  description: "Invoicing software for freelancers and small agencies.",
  url: LONG,
  updated_at: "2026-01-01T00:00:00Z",
};

/** Gives the browser a signed-in Supabase session cookie that the fake server accepts. */
export async function signIn(context: BrowserContext, baseURL: string) {
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const session = {
    access_token: "e2e.access.token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 4102444800,
    refresh_token: "e2e-refresh",
    user: FAKE_USER,
  };
  await context.addCookies([
    {
      name: `sb-${ref}-auth-token`,
      value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
      url: baseURL,
    },
  ]);
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Answers every /api/** call with populated data (long strings on purpose). Nothing reaches a real backend. */
export async function mockSettingsApi(page: Page) {
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== "GET" && path !== "/api/notifications/preferences") return json(route, {});
    if (path === "/api/project") return json(route, { project: PROJECT, projects: [PROJECT, { ...PROJECT, id: "2" }] });
    if (path === "/api/usage") return json(route, { planTier: "pro", balance: 1200, used: 80, history: [] });
    if (path === "/api/notifications/preferences") {
      const saved = req.method() === "GET" ? null : req.postDataJSON()?.prefs;
      return json(route, {
        prefs: saved ?? {
          categories: { digest: "weekly", outcomes: "instant", credits: "instant", approvals: "daily", integrations: "instant", content: "daily" },
          paused: false,
          timezone: "Europe/Berlin",
        },
        unsubscribedAll: false,
        emailConfigured: true,
        email: "a.very.long.email.address.for.layout.testing@subdomain.example-company.test",
      });
    }
    if (path === "/api/credits") return json(route, { balance: 1200, billingEnabled: false });
    return json(route, {});
  });
}
