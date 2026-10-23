# E2E tests

Playwright (chromium only) checks the auth screens in `app/login/page.tsx` and the signed-in dashboard: layout (`dashboard-layout.spec.ts`), accessibility (`a11y.spec.ts`), runtime vitals (`vitals.spec.ts`) and visual snapshots (`visual.spec.ts`).

- **Run locally:** `npx playwright install chromium` once, then `npm run e2e` (or `npm run e2e:ui`). Playwright starts `npm run dev` on port 3000 if nothing is running there.
- **Mocked:** every Supabase Auth call (`**/auth/v1/**`) is intercepted with `page.route()` in `support/supabaseMock.ts`. No user is created, no email is sent, and Supabase is never contacted.
- **Deployed URL (read-only):** `E2E_BASE_URL=https://<host> npm run e2e` runs against that app without starting a dev server. Tests that would make the server call real Supabase after a mocked login are skipped there.
- **Not run by `npm test` or eslint.** Tests run only through Playwright (`npm run e2e`, or the manual "E2E (manual)" GitHub workflow).
- **Google test:** runs only when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`. Otherwise it is skipped.
- **`test.fixme` tests** are known gaps that fail on main: an already-registered sign-up, resend confirmation not shown, and OAuth error in the URL hash. Remove the `fixme` when the fix lands.
- **Dashboard layout:** `dashboard-layout.spec.ts` signs in with a fake session cookie. The server-side session check in `proxy.ts` is answered by a tiny local fake Supabase (`support/fakeSupabaseServer.ts`, started by `playwright.config.ts` on port 54329; set `E2E_SUPABASE_URL` to change it), and every `/api/**` call is mocked in `support/dashboardMock.ts` with a populated project (60 leads, findings, SEO audit). It checks no page scroll, equal panel bottoms, no horizontal overflow, a compact header, the Leads scroll area, and that the header terminal overlay does not move the panels at 1888x867, 1536x730, 1366x768 and 1280x720. Reusing an already-running dev server needs it to have been started with the same `NEXT_PUBLIC_SUPABASE_URL`.
- **Signed-in pages** (`settings-responsive.spec.ts`): the server-side session check cannot be intercepted by `page.route()`, so Playwright also starts `support/fakeSupabaseServer.ts` (port 54329, override with `E2E_SUPABASE_URL`) and the specs sign in with a cookie from `support/settingsMock.ts`. `/api/**` is mocked per page.

## Quality suites

All three use the same mocked, signed-in dashboard as `dashboard-layout.spec.ts` (fake Supabase server plus `support/dashboardMock.ts`), so none of them needs a backend. Run one with `npx playwright test <file>`, for example `npx playwright test a11y.spec.ts`.

### Accessibility: `a11y.spec.ts`

- Runs axe-core (`@axe-core/playwright`) on the dashboard at 1536x730 (default view, each Analytics tab, header log open), at 390x844 (each of the four tab-shell tabs), on nine settings pages and on the login/sign-up screens.
- Fails on any **serious or critical** violation that is not in `support/a11yAllowlist.ts`. Minor and moderate findings are ignored.
- The allowlist holds today's known violations so the suite is green now and blocks new ones. Each entry has `rule`, `selector`, `reason` and optional `pages`. Selectors are matched exactly after `:nth-child(7)` is normalised to `:nth-child(N)` and icon attributes are dropped (`support/a11y.ts`), so one entry covers a repeated list row.
- **See everything that is currently flagged:** `A11Y_AUDIT=1 npx playwright test a11y.spec.ts`. This ignores the allowlist, so the tests fail by design; read the `[a11y] <page> | <impact> | <rule> | <selector> | xN` lines in the output.
- **After fixing something:** delete its allowlist entry (a leftover entry is harmless but would hide a regression of that node). Never add an entry for a new violation without a reason that says what will fix it.
- A page that crashes into the Next.js error screen fails with that message instead of being scanned as an error page.

### Vitals: `vitals.spec.ts`

All at 1536x730. Metrics come from `PerformanceObserver` probes in `support/vitals.ts`.

- **CLS < 0.1** for page load, the Leads panel populating, each Analytics tab switch (SEO, Links, Technical, GEO, Traffic, Findings), and the total. Every layout shift counts, including those right after a click.
- **Stable positions:** the header and the four panel tops are sampled every 250ms for 6s from the moment the header exists and must not move.
- **Long tasks** (main thread blocked over 50 ms) across the whole journey must stay at or under `LONG_TASK_BUDGET` in the spec: the worst measured count plus 30%. It was measured on the Next dev server, so it includes dev-only work. Run on a faster or slower machine and it can need re-measuring: print the count with `npx playwright test vitals.spec.ts -g "long tasks"` (`[vitals] long tasks count=...`), update `MEASURED_LONG_TASKS`, or override once with `E2E_LONGTASK_BUDGET=<n>`.
- **No console errors/warnings, page errors, failed requests or HTTP >= 400.** Known noise goes in `KNOWN_PROBLEMS` (with a reason); URLs the mocks intentionally answer with an error go in `MOCKED_404`.
- `E2E_VITALS_DEBUG=1` prints each layout shift with the elements that moved.

### Visual: `visual.spec.ts`

- `toHaveScreenshot` of the dashboard at 1536x730 and 390x844 (Context and Leads tabs), `maxDiffPixelRatio` 0.02, animations disabled, a fixed clock so relative times do not change, the Next dev overlay hidden, and `<time>` / `[data-volatile]` elements masked. Mark anything else that changes between runs with `data-volatile`.
- Baselines are committed in `e2e/__screenshots__/visual.spec.ts/`. `snapshotPathTemplate` in `playwright.config.ts` drops the OS suffix, so every OS compares against the same files. **The committed baselines are Chromium on Windows**; a Linux runner renders fonts and anti-aliasing differently and will not match.
- **Run / skip:** on by default locally. In CI (`CI` set) it is skipped unless `E2E_VISUAL=1`; `E2E_VISUAL=0` skips it anywhere.
- **Update baselines locally** (after an intended UI change): `npx playwright test visual.spec.ts --update-snapshots`, review the images, commit them.
- **Regenerate on ubuntu (needed before turning it on in the workflow):** run the manual "E2E (manual)" workflow from the Actions tab with `visual` and `update_snapshots` ticked. Download the `visual-baselines` artifact, copy it over `e2e/__screenshots__/`, commit. From then on run the workflow with `visual` ticked to compare. The a11y allowlist selectors and the long-task budget were also measured on Windows; if either fails on ubuntu for reasons unrelated to a change, re-measure there.

### Running against a dev server you started yourself

`E2E_BASE_URL=http://localhost:3100 npx playwright test` skips the built-in web servers. Start the fake Supabase server (`FAKE_SUPABASE_PORT=54329 node --experimental-strip-types e2e/support/fakeSupabaseServer.ts`) and the app with `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54329 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-placeholder-anon-key npx next dev --webpack -p 3100` first. Note `next dev` rewrites `AGENTS.md`; restore it before committing.
