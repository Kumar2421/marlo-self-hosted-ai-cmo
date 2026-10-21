# E2E tests

Playwright (chromium only) checks the auth screens in `app/login/page.tsx` and the signed-in dashboard layout (`dashboard-layout.spec.ts`).

- **Run locally:** `npx playwright install chromium` once, then `npm run e2e` (or `npm run e2e:ui`). Playwright starts `npm run dev` on port 3000 if nothing is running there.
- **Mocked:** every Supabase Auth call (`**/auth/v1/**`) is intercepted with `page.route()` in `support/supabaseMock.ts`. No user is created, no email is sent, and Supabase is never contacted.
- **Deployed URL (read-only):** `E2E_BASE_URL=https://<host> npm run e2e` runs against that app without starting a dev server. Tests that would make the server call real Supabase after a mocked login are skipped there.
- **Not run by `npm test` or eslint.** Tests run only through Playwright (`npm run e2e`, or the manual "E2E (manual)" GitHub workflow).
- **Google test:** runs only when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`. Otherwise it is skipped.
- **`test.fixme` tests** are known gaps that fail on main: an already-registered sign-up, resend confirmation not shown, and OAuth error in the URL hash. Remove the `fixme` when the fix lands.
- **Dashboard layout:** `dashboard-layout.spec.ts` signs in with a fake session cookie. The server-side session check in `proxy.ts` is answered by a tiny local fake Supabase (`support/fakeSupabaseServer.ts`, started by `playwright.config.ts` on port 54329; set `E2E_SUPABASE_URL` to change it), and every `/api/**` call is mocked in `support/dashboardMock.ts` with a populated project (60 leads, findings, SEO audit). It checks no page scroll, equal panel bottoms, no horizontal overflow, a compact header, the Leads scroll area, and that the header terminal overlay does not move the panels at 1888x867, 1536x730, 1366x768 and 1280x720. Reusing an already-running dev server needs it to have been started with the same `NEXT_PUBLIC_SUPABASE_URL`.
