import type { Page, Route } from "@playwright/test";
import { SEO_AUDIT } from "./dashboardMock.ts";

/**
 * Presentation fixtures for the README screenshots and demo (scripts/docs/screenshots.mts).
 * Layered on top of mockDashboardApi: call mockReadmeApi(page) AFTER mockDashboardApi(page) so these
 * answers win. Everything is obviously fictional (Acme Invoice, acme.example.test, example.test
 * addresses). Test support only; nothing here is imported by app code.
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT = {
  id: PROJECT_ID,
  name: "Acme Invoice",
  category: "SaaS",
  description: "Invoicing software for freelancers and small agencies.",
  url: "https://acme.example.test",
  updated_at: "2026-01-01T00:00:00Z",
};
const T0 = "2026-01-01T09:00:00Z";

const PEOPLE: [string, string, string, string][] = [
  ["Maya Okafor", "Founder", "Northwind Studio", "London, UK"],
  ["Jonas Lindqvist", "Head of Operations", "Brightline Agency", "Stockholm, Sweden"],
  ["Priya Raman", "Co-founder", "Lumen Freelance Co.", "Berlin, Germany"],
  ["Tomas Herrera", "Finance Lead", "Pixel & Pine", "Madrid, Spain"],
  ["Hannah Weiss", "Managing Director", "Studio Kestrel", "Vienna, Austria"],
  ["Leo Martins", "Owner", "Harbor Design Works", "Lisbon, Portugal"],
  ["Aoife Brennan", "Founder", "Fieldnote Consulting", "Dublin, Ireland"],
  ["Samir Haddad", "COO", "Orchard Digital", "Amsterdam, Netherlands"],
];

export const READMEFIX_LEADS = PEOPLE.map(([name, title, company, location], i) => ({
  id: `lead_${i}`,
  name,
  title,
  company,
  location,
  email: `${name.split(" ")[0].toLowerCase()}@${company.toLowerCase().replace(/[^a-z]+/g, "")}.example.test`,
  email_verified: i % 4 === 3 ? 0 : 1,
  source_url: `https://${company.toLowerCase().replace(/[^a-z]+/g, "")}.example.test/about`,
  query: "freelance agencies that invoice clients monthly",
  created_at: T0,
  lead_type: "person",
  email_status: i === 1 ? "sent" : null,
}));

type F = { entityId: string; category: string; source?: string; severity: "info" | "warning" | "critical"; label: string; rec: string; status?: string; pages: string[]; evidence?: Record<string, unknown> };
const SPEC: F[] = [
  { entityId: "meta-description-missing", category: "meta-description", severity: "critical", label: "Meta description is missing", rec: "Add a meta description between 120 and 160 characters that says what the page offers.", pages: ["/pricing", "/features", "/blog/late-payment-guide", "/about"], evidence: { length: 0 } },
  { entityId: "canonical-missing", category: "canonical", severity: "warning", label: "Canonical link is missing", rec: "Add a rel=canonical tag that points to the preferred URL of the page.", pages: ["/", "/features"] },
  { entityId: "robots-ai", category: "ai-readiness", source: "geo", severity: "warning", label: "AI crawlers are blocked in robots.txt", rec: "Allow GPTBot and ClaudeBot in robots.txt so AI tools can read your pages.", pages: ["/robots.txt"] },
  { entityId: "lighthouse-button-name", category: "accessibility", severity: "warning", label: "Buttons do not have an accessible name", rec: "Give every button a text label or an aria-label.", pages: ["/"], evidence: { auditId: "button-name", device: "mobile", mode: "diagnostic", score: null, displayValue: "3 elements" } },
  { entityId: "twitter-card-missing", category: "social", severity: "info", label: "twitter:card tag is missing", rec: "Add a twitter:card meta tag so shared links get a preview.", pages: ["/"], status: "fixing" },
  { entityId: "title-too-long", category: "title", severity: "info", label: "Page title is longer than 60 characters", rec: "Shorten the title so it is not cut off in search results.", pages: ["/blog/late-payment-guide"], status: "verified" },
];
export const README_FINDINGS = SPEC.flatMap((s, si) =>
  s.pages.map((p, pi) => ({
    id: `finding_${si}_${pi}`,
    projectId: PROJECT_ID,
    source: s.source ?? "seo-audit",
    category: s.category,
    entityType: "page",
    entityId: s.entityId,
    url: `https://acme.example.test${p}`,
    severity: s.severity,
    evidence: { label: s.label, ...(s.evidence ?? {}) },
    recommendation: s.rec,
    status: s.status ?? "new",
    firstSeen: T0,
    lastSeen: T0,
    resolvedAt: s.status === "verified" ? T0 : null,
  })),
);

const days = Array.from({ length: 28 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 11, 4 + i));
  const wave = 1 + 0.35 * Math.sin(i / 3) + i * 0.015;
  const clicks = Math.round(52 * wave);
  const impressions = Math.round(1900 * wave);
  return { date: d.toISOString().slice(0, 10), clicks, impressions, ctr: clicks / impressions, position: 14.2 - i * 0.05 };
});
const q = (query: string, clicks: number, impressions: number, position: number) => ({ query, clicks, impressions, ctr: clicks / impressions, position });
export const README_TRAFFIC = {
  range: { startDate: "2025-12-04", endDate: "2025-12-31" },
  site: "sc-domain:acme.example.test",
  propertyName: "Acme Invoice (demo)",
  status: "ok",
  reason: null,
  needs_reconnect: false,
  byDate: days,
  topQueries: [
    q("invoice software for freelancers", 212, 6400, 5.8),
    q("acme invoice", 148, 410, 1.2),
    q("how to chase a late payment", 96, 5200, 8.4),
    q("freelance invoice template", 71, 9100, 11.7),
    q("recurring invoice app", 44, 3300, 9.9),
  ],
  opportunities: [{ ...q("late payment reminder email", 12, 4100, 12.3), score: 84, rankingPages: [{ url: "https://acme.example.test/blog/late-payment-guide", clicks: 12, impressions: 4100, ctr: 0.003, position: 12.3 }] }],
  search: null,
  totals: { clicks: days.reduce((a, d) => a + d.clicks, 0), impressions: days.reduce((a, d) => a + d.impressions, 0), ctr: 0.034, position: 13.1 },
  gscError: null,
  ga4: { sessions: 4210, activeUsers: 3180, screenPageViews: 9870 },
  ga4Error: null,
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Fictional leads, a varied Findings list and a healthy Traffic tab. Install after mockDashboardApi. */
export async function mockReadmeApi(page: Page) {
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === "GET") {
      if (path === "/api/project/data") {
        const empty = ["project_documents", "project_competitors", "link_checks", "geo_checks", "site_crawls", "traffic_checks", "code_fixes"];
        const data: Record<string, unknown[]> = Object.fromEntries(empty.map((k) => [k, []]));
        data.seo_audits = [{ id: "audit_1", payload: SEO_AUDIT, created_at: T0 }];
        data.findings = README_FINDINGS;
        data.leads = READMEFIX_LEADS;
        return json(route, { project: PROJECT, projectId: PROJECT_ID, data });
      }
      if (path === "/api/agents/leads/search") return json(route, { leads: READMEFIX_LEADS });
      if (path === "/api/agents/analytics/findings") return json(route, { findings: README_FINDINGS });
      if (path === "/api/agents/analytics/traffic") return json(route, README_TRAFFIC);
      if (path === "/api/agents/automation") return json(route, { settings: { mode: "off" } });
      if (path === "/api/search/overview") {
        const rows = (k: number) => README_TRAFFIC.topQueries.map((r) => ({ clicks: Math.round(r.clicks * k), impressions: Math.round(r.impressions * k), position: r.position }));
        return json(route, {
          snapshot: { capturedAt: T0, snapshotDate: "2025-12-31" },
          stats: { d28: { queries: rows(1) }, prev28: { queries: rows(0.82) } },
          weekChanges: [
            { type: "improved", query: "invoice software for freelancers", detail: "Moved from position 7.4 to 5.8." },
            { type: "appeared", query: "recurring invoice app", detail: "Now showing in the top 10." },
          ],
          nextActions: [{ title: "Write a page for \"late payment reminder email\"", why: "4,100 views in 28 days but you rank on page 2 with only a blog mention.", expectedImpact: "More clicks from a query you already almost win" }],
          yourFixes: [],
        });
      }
      if (path === "/api/project/integrations") {
        return json(route, { projectId: PROJECT_ID, integrations: [], google: { connected: true, needsReconnect: false, reason: null, lastSyncAt: T0 } });
      }
    }
    return route.fallback();
  });
}
