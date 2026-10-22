/**
 * Regenerates every image in docs/images/ (README screenshots, wordmark and demo.gif).
 *
 * Privacy: the images come ONLY from the repo's fake e2e data (e2e/support/dashboardMock.ts,
 * settingsMock.ts, setupResumeMock.ts, readmeFixtures.ts) served by a local fake Supabase.
 * Nothing contacts a real account, backend or provider, and the browser is Playwright's own
 * Chromium, never your Chrome profile.
 *
 * Run it (from the frontend folder), in three terminals or in the background:
 *
 *   1. Fake Supabase (answers the server-side session check):
 *        FAKE_SUPABASE_PORT=54330 node --experimental-strip-types e2e/support/fakeSupabaseServer.ts
 *   2. The app, pointed at that fake and with placeholder keys:
 *        NEXT_PUBLIC_SUPABASE_URL=http://localhost:54330 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-placeholder-anon-key \
 *        SUPABASE_SECRET_KEY=e2e-placeholder npx next dev --webpack -p 3100
 *      (`next dev` rewrites AGENTS.md; restore it before committing.)
 *   3. This script:
 *        E2E_BASE_URL=http://localhost:3100 E2E_SUPABASE_URL=http://localhost:54330 npm run docs:screenshots
 *
 * Environment:
 *   E2E_BASE_URL       app URL (default http://localhost:3100)
 *   E2E_SUPABASE_URL   fake Supabase URL (default http://localhost:54330; must match the app's
 *                      NEXT_PUBLIC_SUPABASE_URL because the session cookie name is derived from it)
 *   DOCS_ONLY          comma list to regenerate a subset, e.g. DOCS_ONLY=hero-dashboard,demo
 *                      (names: logo, hero-dashboard, findings, finding-drawer, geo, traffic, pricing,
 *                      settings-integrations, mobile, onboarding, setup-progress, demo)
 *
 * Needs ffmpeg for demo.gif (frame extraction only): it uses the binary Playwright downloads
 * (ms-playwright/ffmpeg-*) or FFMPEG_PATH, or an `ffmpeg` on PATH. PNGs and the GIF are written with
 * sharp (already a dependency).
 * logo.svg is the source of truth for the logo (see docs/images/README.md); logo.png and
 * logo-wordmark.png are rendered from it here.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import sharp from "sharp";

process.env.E2E_SUPABASE_URL ||= "http://localhost:54330";
const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";

// Imported after the env default above: the mocks read E2E_SUPABASE_URL when they load.
const { mockDashboardApi, serveLottieWasmLocally, signIn } = await import("../../e2e/support/dashboardMock.ts");
const settings = await import("../../e2e/support/settingsMock.ts");
const { ALL_DONE, mockSetupApi, stateOf } = await import("../../e2e/support/setupResumeMock.ts");
const { mockReadmeApi, README_FINDINGS } = await import("../../e2e/support/readmeFixtures.ts");

const OUT = join(process.cwd(), "docs", "images");
const TMP = join(process.cwd(), "test-results", "docs-screenshots");
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const only = new Set((process.env.DOCS_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean));
const wanted = (name: string) => only.size === 0 || only.has(name);
const FIXED_NOW = new Date("2026-01-02T12:00:00Z");
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const browser = await chromium.launch();
const problems: string[] = [];

/** Phone-sized or desktop context with a fixed clock, light theme and the dev badge hidden. */
async function open(name: string, width: number, height: number, extra: { video?: boolean } = {}) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width, height },
    deviceScaleFactor: extra.video ? 1 : 2,
    colorScheme: "light",
    reducedMotion: "no-preference",
    ...(extra.video ? { recordVideo: { dir: join(TMP, "video"), size: { width, height } } } : {}),
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const st = document.createElement("style");
      st.textContent = "nextjs-portal{display:none!important} *{caret-color:transparent!important}";
      document.head.appendChild(st);
    });
  });
  page.on("console", (m) => {
    const t = m.text();
    // Mock gaps and dev noise that do not reflect the app: social drafts routes, aborted lottie fetch, HMR.
    if (m.type() === "error" && !/Query data cannot be undefined|ghost-loader\.lottie|favicon|Failed to load resource/.test(t)) problems.push(`[${name}] console: ${t}`);
  });
  page.on("pageerror", (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  await signIn(context, BASE);
  await serveLottieWasmLocally(page);
  return { context, page };
}

/** Full dashboard mocks plus the fictional README fixtures. */
async function dashboard(name: string, width: number, height: number, extra: { video?: boolean } = {}) {
  const ctx = await open(name, width, height, extra);
  await mockDashboardApi(ctx.page);
  await mockReadmeApi(ctx.page);
  return ctx;
}

/** Navigates and waits for `ready`; the dev server occasionally serves a page that never hydrates, so reload once. */
async function gotoReady(page: Page, url: string, ready: () => Promise<unknown>) {
  await page.goto(url, { timeout: 180_000 });
  try {
    await Promise.race([ready(), new Promise((_, rej) => setTimeout(() => rej(new Error("not ready")), 45_000))]);
  } catch {
    await page.reload({ timeout: 180_000 });
    await ready();
  }
}

const analytics = (page: Page) => page.locator("div[style*='grid-template-columns'] > *").nth(1);

async function waitSettled(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

/** Saves a PNG at 2x then downsizes to at most `maxWidth` and palette-optimises it. */
async function save(name: string, buf: Buffer, maxWidth = 1600) {
  const meta = await sharp(buf).metadata();
  const out = join(OUT, `${name}.png`);
  await sharp(buf)
    .resize({ width: Math.min(maxWidth, meta.width!), withoutEnlargement: true })
    .png({ palette: true, quality: 92, effort: 10, colours: 192, dither: 0.6 })
    .toFile(out);
  const kb = Math.round(statSync(out).size / 1024);
  console.log(`${name}.png  ${kb} KB${kb > 400 ? "  (over 400 KB)" : ""}`);
}

async function shot(name: string, page: Page, opts: { fullPage?: boolean; maxWidth?: number } = {}) {
  await save(name, await page.screenshot({ fullPage: opts.fullPage }), opts.maxWidth);
}

// ---------------------------------------------------------------- logo
if (wanted("logo")) {
  const svg = readFileSync(join(OUT, "logo.svg"), "utf8");
  await sharp(Buffer.from(svg), { density: 400 })
    .resize({ width: 512, height: 512, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, "logo.png"));
  console.log("logo.png  512x512");

  // Wordmark: the mark and the word, in a mid grey that reads on both white and dark backgrounds.
  const ctx = await browser.newContext({ viewport: { width: 760, height: 220 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const mark = svg.replace(/<svg /, '<svg style="height:176px;width:auto;display:block" ');
  await p.setContent(`<!doctype html><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@700&display=swap">
    <body style="margin:0;background:transparent"><div style="display:flex;align-items:center;gap:28px;padding:22px 30px;width:max-content">
    ${mark}<span style="font:700 128px/1 'DM Sans','Segoe UI',system-ui,sans-serif;letter-spacing:-3px;color:#6f7683">Marlo</span></div>`);
  await p.evaluate(() => document.fonts.ready).catch(() => {});
  await p.waitForTimeout(500);
  const box = await p.locator("body > div").boundingBox();
  const png = await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: Math.ceil(box!.width), height: Math.ceil(box!.height) } });
  await sharp(png).png({ compressionLevel: 9 }).toFile(join(OUT, "logo-wordmark.png"));
  console.log("logo-wordmark.png");
  await ctx.close();
}

// ---------------------------------------------------------------- dashboard shots (1440x900)
if (["hero-dashboard", "findings", "finding-drawer", "geo", "traffic"].some(wanted)) {
  const { context, page } = await dashboard("dashboard", 1440, 900);
  {
    // First request compiles the dashboard in the dev server.
    const panel = analytics(page);
    await gotoReady(page, "/dashboard", () => page.waitForSelector('[data-testid="fix-first"][data-state="actions"]', { timeout: 60_000 }));
    await waitSettled(page);

    if (wanted("hero-dashboard")) {
      await panel.getByRole("tab", { name: "SEO", exact: true }).click();
      await waitSettled(page);
      await shot("hero-dashboard", page);
    }
    if (wanted("findings")) {
      await panel.getByRole("tab", { name: "Findings", exact: true }).click();
      await waitSettled(page);
      await shot("findings", page);
    }
    if (wanted("finding-drawer")) {
      await panel.getByRole("tab", { name: "Findings", exact: true }).click();
      await panel.getByTestId("fix-first").getByRole("button", { name: /^(Open|Fix this)$/ }).first().click();
      await page.getByRole("dialog").waitFor();
      await waitSettled(page);
      await shot("finding-drawer", page);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" }).catch(() => {});
    }
    if (wanted("geo")) {
      await panel.getByRole("tab", { name: "GEO", exact: true }).click();
      const gap = panel.getByRole("button", { name: "Track as a fix" }).first();
      await gap.waitFor();
      // Scroll the AI readiness block to the top of the panel so the gap and its button are in frame.
      await panel.getByText("Readiness score for").evaluate((el) => el.closest("div[class*='overflow-hidden']")!.scrollIntoView({ block: "start" }));
      await panel.getByText("AI readiness", { exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
      await waitSettled(page);
      await shot("geo", page);
    }
    if (wanted("traffic")) {
      await panel.getByRole("tab", { name: "Traffic", exact: true }).click();
      await page.getByText("Acme Invoice (demo)").first().waitFor({ timeout: 30_000 }).catch(() => {});
      await waitSettled(page);
      await shot("traffic", page);
    }
  }
  await context.close();
}

// ---------------------------------------------------------------- pricing (1280, Annual)
if (wanted("pricing")) {
  const { context, page } = await open("pricing", 1280, 900);
  await page.goto("/pricing", { timeout: 180_000 });
  await page.getByRole("heading", { level: 1, name: "Pricing" }).waitFor();
  await page.getByRole("tab", { name: "Annual" }).click();
  await waitSettled(page);
  await shot("pricing", page, { fullPage: true });
  await context.close();
}

// ---------------------------------------------------------------- settings > integrations
if (wanted("settings-integrations")) {
  const { context, page } = await open("settings", 1440, 900);
  await settings.mockSettingsApi(page);
  await page.goto("/settings/integrations", { timeout: 180_000 });
  await page.getByRole("heading", { name: "Article Publishing" }).waitFor({ timeout: 60_000 });
  await waitSettled(page);
  await shot("settings-integrations", page);
  await context.close();
}

// ---------------------------------------------------------------- mobile (390x844, Analytics landing)
if (wanted("mobile")) {
  const { context, page } = await dashboard("mobile", 390, 844);
  await gotoReady(page, "/dashboard", () => page.waitForSelector('[data-testid="fix-first"][data-state="actions"]', { timeout: 60_000 }));
  await waitSettled(page);
  await shot("mobile", page, { maxWidth: 780 });
  await context.close();
}

// ---------------------------------------------------------------- onboarding modal (no project yet)
if (wanted("onboarding")) {
  const { context, page } = await open("onboarding", 1440, 900);
  await mockDashboardApi(page);
  await mockSetupApi(page, { project: false });
  await gotoReady(page, "/dashboard", () => page.getByPlaceholder("yourproduct.com").waitFor({ timeout: 60_000 }));
  await page.getByPlaceholder("yourproduct.com").fill("acme.example.test");
  // The mock has no project yet, so the app toasts that it could not load project context. Not part of the story.
  const toast = page.getByText("Failed to load shared project context.");
  if (await toast.isVisible().catch(() => false)) await toast.locator("xpath=following-sibling::button").click().catch(() => {});
  await page.waitForTimeout(600);
  await waitSettled(page);
  await shot("onboarding", page);
  await context.close();
}

// ---------------------------------------------------------------- Finish setup card (resuming state)
if (wanted("setup-progress")) {
  const { context, page } = await dashboard("setup-progress", 1440, 900);
  await mockSetupApi(page, {
    project: true,
    state: stateOf({
      ...ALL_DONE,
      "marketing-strategy": { status: "failed", error: "generation failed" },
      "design-guide": "pending",
    }),
  });
  await gotoReady(page, "/dashboard", () => page.getByLabel("Finish setup").waitFor({ timeout: 60_000 }));
  await waitSettled(page);
  await shot("setup-progress", page);
  await context.close();
}

// ---------------------------------------------------------------- demo.gif
if (wanted("demo")) await demo();

async function demo() {
  rmSync(join(TMP, "video"), { recursive: true, force: true });
  const W = 1280;
  const H = 800;
  const { context, page } = await dashboard("demo", W, H, { video: true });
  // The first finding group is "being fixed", so its drawer has a Re-check button; the server's
  // answer to the re-check is "not verified yet" with a reason (the honest outcome the demo shows).
  const reason = "The live page still has no meta description. Publish the change, then re-check.";
  const findings = README_FINDINGS.map((f) => (f.entityId === "meta-description-missing" ? { ...f, status: "fixing" } : f));
  await page.route("**/api/agents/analytics/findings", (r) =>
    r.request().method() === "PUT"
      ? r.fulfill(json({ finding: findings[0], skipped: true, reason }))
      : r.fulfill(json({ findings })),
  );
  // A visible cursor: video capture does not draw the pointer.
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const dot = document.createElement("div");
      dot.style.cssText = "position:fixed;z-index:2147483647;width:18px;height:18px;border-radius:50%;background:rgba(236,121,23,.85);border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35);pointer-events:none;left:-40px;top:-40px;transform:translate(-50%,-50%)";
      document.body.appendChild(dot);
      window.addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; }, true);
    });
  });
  const t0 = Date.now();
  const panel = analytics(page);
  await gotoReady(page, "/dashboard", () => page.waitForSelector('[data-testid="fix-first"][data-state="actions"]', { timeout: 60_000 }));
  await waitSettled(page);
  const readyAt = (Date.now() - t0) / 1000;

  const glide = async (loc: ReturnType<Page["locator"]>) => {
    const b = (await loc.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 28 });
    await page.waitForTimeout(450);
  };
  await page.mouse.move(W / 2, 160);
  await page.waitForTimeout(1800); // dashboard with the Fix first strip
  const open = panel.getByTestId("fix-first").getByRole("button", { name: /^(Open|Fix this)$/ }).first();
  await glide(open);
  await open.click();
  const drawer = page.getByRole("dialog");
  await drawer.waitFor();
  await page.waitForTimeout(2600); // the finding and why it was flagged
  const recheck = drawer.getByRole("button", { name: "Re-check" });
  await glide(recheck);
  await recheck.click();
  await drawer.getByTestId("recheck-note").waitFor();
  await page.waitForTimeout(3400); // "Not verified yet: ..."
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" }).catch(() => {});
  await page.waitForTimeout(500);
  const geoTab = panel.getByRole("tab", { name: "GEO", exact: true });
  await glide(geoTab);
  await geoTab.click();
  const track = panel.getByRole("button", { name: "Track as a fix" }).first();
  await track.waitFor();
  await panel.getByText("AI readiness", { exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(1500);
  await glide(track);
  await track.click();
  await page.getByText("Added to your findings.").waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2600);

  const video = page.video()!;
  await context.close(); // flushes the .webm
  const webm = await video.path();
  await makeGif(webm, readyAt, join(OUT, "demo.gif"));
}

function ffmpegBinary(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(process.env.LOCALAPPDATA || join(homedir(), ".cache"), "ms-playwright"), join(homedir(), ".cache", "ms-playwright"), join(homedir(), "Library", "Caches", "ms-playwright")].filter(Boolean) as string[];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    for (const d of readdirSync(r).filter((x) => x.startsWith("ffmpeg-")).sort().reverse()) {
      for (const f of ["ffmpeg-win64.exe", "ffmpeg-linux", "ffmpeg-mac", "ffmpeg"]) if (existsSync(join(r, d, f))) return join(r, d, f);
    }
  }
  return "ffmpeg";
}

/**
 * Video -> GIF without ffmpeg's gif tooling. The ffmpeg that Playwright downloads is a tiny VP8-only
 * build (no palettegen/paletteuse/fps filters, no gif encoder), so it only extracts frames here
 * (10 fps, 900 px wide, starting when the dashboard is ready); sharp (libvips + cgif) then writes
 * the animated GIF with a reduced, optimised palette. Any ffmpeg with `scale` works (FFMPEG_PATH).
 */
async function makeGif(webm: string, skipSeconds: number, out: string) {
  const ff = ffmpegBinary();
  const dir = join(TMP, "frames");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync(ff, ["-hide_banner", "-loglevel", "error", "-y", "-ss", skipSeconds.toFixed(2), "-i", webm, "-r", "10", "-vf", "scale=900:-1", join(dir, "%04d.png")]);
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const raws: Buffer[] = [];
  let width = 0;
  let height = 0;
  for (const f of files) {
    const r = await sharp(join(dir, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    width = r.info.width;
    height = r.info.height;
    raws.push(r.data);
  }
  // Hold the last frame a little longer so the loop does not snap back mid-toast.
  const delay = files.map((_, i) => (i === files.length - 1 ? 1500 : 100));
  await sharp(Buffer.concat(raws), { raw: { width, height: height * files.length, channels: 4, pageHeight: height } })
    .gif({ delay, loop: 0, colours: 64, effort: 7, dither: 0.5, interFrameMaxError: 6, interPaletteMaxError: 3 })
    .toFile(out);
  const mb = statSync(out).size / 1024 / 1024;
  console.log(`demo.gif  ${mb.toFixed(2)} MB, ${files.length} frames (~${(files.length / 10).toFixed(1)} s)${mb > 6 ? "  (over 6 MB)" : ""}`);
}

await browser.close();
if (problems.length) {
  console.log("\nProblems seen while capturing (review before committing):");
  for (const p of problems) console.log(" - " + p);
}
