import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL points the suite at an already-running app (local or deployed).
// When it is unset, Playwright starts the dev server on localhost:3000.
const externalBaseUrl = process.env.E2E_BASE_URL || undefined; // empty string (workflow default) counts as unset
const baseURL = externalBaseUrl ?? "http://localhost:3000";

// The dev server gets placeholder Supabase config so the auth screens render
// without real credentials. Every Supabase auth request made by the browser is
// intercepted with page.route() in e2e/. The server-side session check for
// /dashboard and /settings cannot be intercepted, so the URL points at a tiny
// local fake (e2e/support/fakeSupabaseServer.ts, started below). Override the
// URL with E2E_SUPABASE_URL; the fake listens on that URL's port.
// Placeholder values are forced over any local .env so a developer's real
// Supabase URL can never be reached from the test run.
const supabaseUrl = process.env.E2E_SUPABASE_URL || "http://localhost:54329";
const fakeSupabasePort = new URL(supabaseUrl).port || "54329";
const devServerEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-placeholder-anon-key",
} as Record<string, string>;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : [
        {
          command: "node --experimental-strip-types e2e/support/fakeSupabaseServer.ts",
          url: `${new URL(supabaseUrl).origin}/health`,
          reuseExistingServer: true,
          env: { ...process.env, FAKE_SUPABASE_PORT: fakeSupabasePort } as Record<string, string>,
        },
        {
          command: "npm run dev",
          url: baseURL,
          reuseExistingServer: true,
          timeout: 180_000,
          env: devServerEnv,
        },
      ],
});
