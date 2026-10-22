# README images

Every image here is generated from the repo's fake e2e data (Acme Invoice, `acme.example.test`, example.test addresses) by `scripts/docs/screenshots.mts`. No real account, key, project or person appears in them, and they are never captured from a live deployment.

| File | What it shows |
| --- | --- |
| `logo.svg` | The Marlo ghost, vector. Source of truth for the logo. |
| `logo.png` | `logo.svg` at 512x512, transparent. |
| `logo-wordmark.png` | Ghost plus the word "Marlo", transparent, mid-grey text that reads on light and dark backgrounds. |
| `hero-dashboard.png` | The full dashboard (1440x900): Context, Analytics with the "Fix first" strip, Leads and Chat. |
| `findings.png` | Analytics, Findings tab: counts and the prioritised list. |
| `finding-drawer.png` | A finding opened: why it was flagged, what to do, fix options and progress. |
| `geo.png` | Analytics, GEO tab: AI readiness checks with a gap and its "Track as a fix" button. |
| `traffic.png` | Analytics, Traffic tab in a healthy state (Search Console and GA4 numbers). |
| `pricing.png` | `/pricing` at 1280 wide with Annual selected. |
| `settings-integrations.png` | Settings, Integrations. |
| `mobile.png` | Dashboard at 390x844, Analytics landing. |
| `onboarding.png` | The new-project onboarding modal. |
| `setup-progress.png` | The "Finish setup" card when a setup step failed and is waiting on a retry. |
| `demo.gif` | About 15 seconds: Fix first -> finding drawer -> Re-check ("Not verified yet: ...") -> GEO "Track as a fix". |

Screenshots are taken at a 1440x900 viewport (390x844 for mobile, 1280 for pricing), light theme, device scale factor 2, then downscaled to at most 1600 px wide and palette-optimised with sharp.

## How the logo was derived

`public/ghost-loader.lottie` is the owner-provided loading animation. Frame 0 (the resting pose) was rendered to SVG with lottie-web's SVG renderer in a throwaway page, then cleaned by hand: the ground-shadow ellipse and the clip path were dropped, colours were converted to hex, coordinates were rounded to one decimal, and the viewBox was cropped to the ghost. The result is real vector paths (not a traced bitmap) in `logo.svg`. `logo.png` and `logo-wordmark.png` are rendered from that SVG by the script. If the animation changes, redo the frame-0 export and replace `logo.svg`.

## Regenerating

From the `frontend` folder, start the fake Supabase and the app, then run the script (details in the header of `scripts/docs/screenshots.mts`):

```bash
FAKE_SUPABASE_PORT=54330 node --experimental-strip-types e2e/support/fakeSupabaseServer.ts
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54330 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-placeholder-anon-key \
  SUPABASE_SECRET_KEY=e2e-placeholder npx next dev --webpack -p 3100
E2E_BASE_URL=http://localhost:3100 E2E_SUPABASE_URL=http://localhost:54330 npm run docs:screenshots
```

- `DOCS_ONLY=hero-dashboard,demo` regenerates a subset (names: `logo`, `hero-dashboard`, `findings`, `finding-drawer`, `geo`, `traffic`, `pricing`, `settings-integrations`, `mobile`, `onboarding`, `setup-progress`, `demo`).
- It uses Playwright's own Chromium (`npx playwright install chromium` once). `demo.gif` needs ffmpeg: the binary Playwright downloads is found automatically, or set `FFMPEG_PATH`.
- Extra fictional data for these shots lives in `e2e/support/readmeFixtures.ts`; it is layered on the existing e2e mocks and never touches app code.
- `next dev` rewrites `AGENTS.md`; restore it before committing.
