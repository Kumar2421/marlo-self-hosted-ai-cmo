# E2E tests

Playwright (chromium only) checks the auth screens in `app/login/page.tsx`.

- **Run locally:** `npx playwright install chromium` once, then `npm run e2e` (or `npm run e2e:ui`). Playwright starts `npm run dev` on port 3000 if nothing is running there.
- **Mocked:** every Supabase Auth call (`**/auth/v1/**`) is intercepted with `page.route()` in `support/supabaseMock.ts`. No user is created, no email is sent, and Supabase is never contacted.
- **Deployed URL (read-only):** `E2E_BASE_URL=https://<host> npm run e2e` runs against that app without starting a dev server. Tests that would make the server call real Supabase after a mocked login are skipped there.
- **Not run by `npm test` or eslint.** Tests run only through Playwright (`npm run e2e`, or the manual "E2E (manual)" GitHub workflow).
- **Google test:** runs only when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`. Otherwise it is skipped.
- **`test.fixme` tests** are known gaps that fail on main: an already-registered sign-up, resend confirmation not shown, and OAuth error in the URL hash. Remove the `fixme` when the fix lands.
