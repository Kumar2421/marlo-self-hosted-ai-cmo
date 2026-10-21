import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page, Route } from "@playwright/test";

/** Same default as playwright.config.ts; the cookie name is derived from this host. */
export const SUPABASE_URL = process.env.E2E_SUPABASE_URL || "http://localhost:54329";

/** Matches the user the fake Supabase server returns; only the id/email need to be plausible. */
const FAKE_USER = {
  id: "00000000-0000-4000-8000-0000000000e2",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e-user@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const PROJECT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme Invoice",
  category: "SaaS",
  description: "Invoicing software for freelancers and small agencies.",
  url: "https://acme.example.test",
  updated_at: "2026-01-01T00:00:00Z",
};

const NOW = "2026-01-01T00:00:00Z";

/** 60 leads with deliberately long strings so truncation and overflow are exercised. */
export const LEADS = Array.from({ length: 60 }, (_, i) => ({
  id: `lead_${i}`,
  name: `Very Long Lead Name Number ${i} With Extra Words To Overflow The Column`,
  title: "Chief Executive Officer And Co-Founder Of Something Extremely Long Title",
  company: `Company ${i} International Holdings Group Limited`,
  location: "San Francisco, California, United States of America",
  email: i % 3 ? `person.number${i}.with.a.very.long.localpart@subdomain.example-company.org` : null,
  email_verified: i % 2,
  source_url: `https://www.example-long-domain-${i}.com/some/very/long/path/index.html`,
  query: "saas founders in europe",
  created_at: NOW,
  lead_type: "person",
  email_status: i % 5 === 0 ? "sent" : null,
}));

const FINDINGS = Array.from({ length: 12 }, (_, i) => ({
  id: `finding_${i}`,
  projectId: PROJECT.id,
  source: "seo",
  category: "meta-description",
  entityType: "page",
  entityId: `/page-${i}`,
  url: `https://acme.example.test/page-${i}`,
  severity: i % 3 === 0 ? "critical" : "warning",
  evidence: { length: 0 },
  recommendation: "Add a meta description between 120 and 160 characters.",
  status: "new",
  firstSeen: NOW,
  lastSeen: NOW,
  resolvedAt: null,
}));

const SEO_AUDIT = {
  url: PROJECT.url,
  meta: { title: "Acme Invoice", description: "Invoicing for freelancers.", canonical: PROJECT.url, robots: "index,follow", indexable: true },
  headings: { h1: 1, h2: 4, h3: 6 },
  openGraph: [{ key: "og:title", value: "Acme Invoice", ok: true }],
  twitter: [{ key: "twitter:card", value: "", ok: false }],
  issues: [{ label: "Missing twitter:card", level: "Warning" }],
  findings: [],
  bodyText: "Acme invoice",
  contentSource: "crawl",
  design: { fonts: ["Inter"] },
  technical: {
    onPageScore: 82,
    server: "nginx",
    status: 200,
    pageSizeBytes: 48_000,
    domSize: 640,
    cacheable: true,
    redirectCount: 0,
    robotsTxt: { exists: true, disallowsThisPage: false },
  },
  serverTiming: { connectMs: 20, tlsHandshakeMs: 30, ttfbMs: 120, downloadMs: 40 },
  renderBlocking: { blockingScripts: 1, blockingStylesheets: 2 },
  contentRelevance: { titleRelevance: 80, descriptionRelevance: 70, keywordRelevance: 60 },
  links: [{ href: "https://acme.example.test/pricing", text: "Pricing", internal: true }],
};

const LEAD_PROFILE = {
  version: 1,
  roles: ["Founder"],
  industries: ["B2B SaaS"],
  sizes: ["11-50"],
  locations: ["Europe"],
  problem: "Freelancers lose hours every month chasing late invoices.",
  exclude: [],
  webRelated: false,
  confirmedAt: NOW,
};

const GEO_READINESS = {
  method: "readiness",
  domain: "acme.example.test",
  score: 70,
  checks: [
    { id: "llms-txt", label: "llms.txt file", weight: 10, status: "pass", detail: "Your site has an llms.txt file.", fix: "" },
    { id: "robots-ai", label: "AI crawlers allowed", weight: 20, status: "fail", detail: "", fix: "Allow GPTBot and ClaudeBot in robots.txt." },
  ],
};

const GEO_OVERVIEW = {
  project: { name: PROJECT.name, domain: "acme.example.test" },
  prompts: [],
  capabilities: { geminiAvailable: false, simulatedAvailable: false, geminiDailyCap: 0, geminiUsedToday: 0, simulatedDailyCap: 0, simulatedUsedToday: 0 },
  lastRunAt: null,
};

const NOTIFICATION_PREFS = {
  prefs: {
    categories: { digest: "weekly", outcomes: "instant", credits: "instant", approvals: "daily", integrations: "instant", content: "daily" },
    paused: false,
    timezone: null,
    quietHours: null,
  },
  unsubscribedAll: false,
  emailConfigured: false,
  email: null,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

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

/** Answers every /api/** call with a populated project. Unknown GETs get `{}`; nothing reaches a real backend. */
export async function mockDashboardApi(page: Page) {
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    // The page saves its timezone with a PUT and writes the answer straight into its cache.
    if (path === "/api/notifications/preferences") return json(route, NOTIFICATION_PREFS);
    if (req.method() !== "GET") return json(route, {});
    if (path === "/api/project") return json(route, { project: PROJECT, projects: [PROJECT] });
    if (path === "/api/project/data") {
      const empty = ["project_documents", "project_competitors", "link_checks", "geo_checks", "site_crawls", "traffic_checks", "code_fixes"];
      const data: Record<string, unknown[]> = Object.fromEntries(empty.map((k) => [k, []]));
      data.seo_audits = [{ id: "audit_1", payload: SEO_AUDIT, created_at: NOW }];
      data.findings = FINDINGS;
      data.leads = LEADS;
      return json(route, { project: PROJECT, projectId: PROJECT.id, data });
    }
    if (path === "/api/agents/leads/search") return json(route, { leads: LEADS });
    if (path === "/api/agents/leads/profile") return json(route, { profile: LEAD_PROFILE, suggestion: null });
    if (path === "/api/agents/seo/audit") return json(route, { payload: SEO_AUDIT });
    if (path === "/api/agents/analytics/findings") return json(route, { findings: FINDINGS });
    if (path === "/api/geo/readiness") return json(route, GEO_READINESS);
    if (path === "/api/geo/referral") return json(route, { notConnected: true });
    if (path === "/api/geo/overview") return json(route, GEO_OVERVIEW);
    if (path === "/api/geo/history") return json(route, { runs: [] });
    if (/^\/api\/agents\/(x|linkedin|reddit)\/drafts$/.test(path)) return json(route, { drafts: [] });
    if (path === "/api/credits") return json(route, { balance: null, billingEnabled: false });
    return json(route, {});
  });
}

/**
 * The loading animation fetches its WebAssembly player from jsdelivr at runtime. Serve the
 * copy from node_modules (same pinned version) so timing, vitals and screenshots do not
 * depend on the network. Without the local file the request is left alone.
 */
export async function serveLottieWasmLocally(page: Page) {
  const file = join(process.cwd(), "node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm");
  if (!existsSync(file)) return;
  const body = readFileSync(file);
  await page.route("https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web@*/dist/dotlottie-player.wasm", (route) =>
    route.fulfill({ status: 200, contentType: "application/wasm", body, headers: { "access-control-allow-origin": "*" } }),
  );
}
