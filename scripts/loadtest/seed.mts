/**
 * Deterministic seed data for the local load test. Rows reference shared string/object pools, so the
 * resident size stays moderate while the JSON the fake server serializes is the full realistic size.
 */
import { table } from "./engine.mts";

export type SeedConfig = {
  users: number;
  projectsPerUser: number;
  /** Fraction of projects that have the daily cron marker rows (default 0.3 as in the P4 plan). */
  markerFraction: number;
  markersPerProject: number;
  leadsPerProject: number;
  findingsPerProject: number;
  snapshotDays: number;
  geoWeeks: number;
};

export const defaultSeed = (): SeedConfig => ({
  users: Number(process.env.LT_USERS || 1000),
  projectsPerUser: Number(process.env.LT_PPU || 3),
  markerFraction: Number(process.env.LT_MARKER_FRACTION || 0.3),
  markersPerProject: Number(process.env.LT_MARKERS || 700),
  leadsPerProject: Number(process.env.LT_LEADS || 150),
  findingsPerProject: Number(process.env.LT_FINDINGS || 20),
  snapshotDays: Number(process.env.LT_SNAP_DAYS || 120),
  geoWeeks: Number(process.env.LT_GEO_WEEKS || 13),
});

const hex12 = (n: number) => n.toString(16).padStart(12, "0");
export const userId = (u: number) => `00000000-0000-4000-8000-${hex12(u)}`;
export const projectId = (g: number) => `11111111-1111-4111-8111-${hex12(g)}`;
const connId = (g: number, kind: number) => `22222222-2222-4222-8222-${hex12(g * 4 + kind)}`;

/** Per-project traits, shared by the seeder and the "eligible" counters. */
export function traits(g: number) {
  const m = g % 10;
  return {
    hasGsc: m < 6, // 60%
    hasProfile: g % 5 < 2, // 40%
    optedIn: m < 3, // 30% have cron marker rows
    gscNoProperty: m < 6 && g % 20 === 3, // a few GSC connections without a selected property
    gscBroken: m < 6 && g % 50 === 7, // needs_reconnect
    heavyGeo: m < 6 && g % 20 === 0,
    leadsDue: g % 7 !== 0, // ~86% never refreshed or stamped >24h ago
    github: g % 20 === 5,
  };
}

const DAY = 86_400_000;
const lorem = "Marlo helps founders understand how their site performs in search, what to fix first, and whether the fixes worked. ".repeat(60);
const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function seed(cfg: SeedConfig) {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const N = cfg.users * cfg.projectsPerUser;

  // ---- shared pools
  const docPool = [4200, 5600, 7200, 3100, 6400].map((n) => lorem.slice(0, n));
  const bodyText = lorem.slice(0, 6000);
  const links = Array.from({ length: 50 }, (_, i) => ({ href: `https://site.example.test/page-${i}`, text: `Page ${i}`, internal: i % 5 !== 0 }));
  const auditTemplates = [0, 1, 2, 3].map((v) => ({
    url: "https://site.example.test",
    meta: { title: "Site", description: "A site.", canonical: "https://site.example.test", robots: "index,follow", indexable: true },
    headings: { h1: 1, h2: 4, h3: 6 },
    issues: [{ label: "Missing twitter:card", level: "Warning" }],
    findings: [],
    bodyText,
    links,
    technical: { onPageScore: 55 + v * 10, server: "nginx", status: 200, pageSizeBytes: 48_000, domSize: 640, cacheable: true, redirectCount: 0 },
    serverTiming: { connectMs: 20, tlsHandshakeMs: 30, ttfbMs: 120, downloadMs: 40 },
    contentRelevance: { titleRelevance: 80, descriptionRelevance: 70, keywordRelevance: 60 },
  }));
  const queries = Array.from({ length: 300 }, (_, i) => ({ query: `search term number ${i} for the product`, clicks: 300 - i, impressions: 4000 - i * 5, ctr: 0.05, position: 3 + (i % 20) }));
  const pages = Array.from({ length: 100 }, (_, i) => ({ page: `https://site.example.test/p/${i}`, clicks: 100 - i, impressions: 2000 - i * 5, ctr: 0.04, position: 5 }));
  const win = { queries, pages, totals: { clicks: 5000, impressions: 90000, ctr: 0.055, position: 9 } };
  const snapshotPayload = { version: 1, windows: { d7: win, d28: win, d90: { ...win, queries: queries.slice(0, 100) } }, rankingPages: pages.slice(0, 50) };
  const excerpt = lorem.slice(0, 400);
  const sources = Array.from({ length: 10 }, (_, i) => `https://source-${i}.example.test/article`);
  const evidencePool = [{ length: 0, selector: "head > meta", note: "Missing meta description", example: lorem.slice(0, 220) }];
  const rec = "Add a meta description between 120 and 160 characters that summarizes the page for searchers.";
  const names = Array.from({ length: 200 }, (_, i) => `Person Name ${i}`);
  const companies = Array.from({ length: 100 }, (_, i) => `Company ${i} International Holdings`);
  const locations = ["Berlin, Germany", "Austin, Texas", "London, UK", "Toronto, Canada"];
  const titles = ["Head of Growth", "Founder", "VP Marketing", "CEO"];
  const kinds = ["weekly_digest", "outcome_measured", "credits_low", "approval_needed", "integration_disconnected"];

  const T = {
    profiles: table("profiles"), projects: table("projects"), settings: table("user_settings"), docs: table("project_documents"),
    comps: table("project_competitors"), audits: table("seo_audits"), findings: table("findings"), leads: table("leads"),
    snaps: table("search_snapshots"), conns: table("integration_connections"), res: table("integration_resources"),
    prompts: table("geo_prompts"), runs: table("geo_runs"), notes: table("notifications"), cfg: table("app_config"),
  };
  T.cfg.add({ id: true, billing_enabled: false });

  const docTypes = ["product_info", "marketing_strategy", "competitor_analysis", "design_guide", "content_strategy"];
  const markerTypes = ["auto_propose_done", "social_daily_attempt:x", "social_daily_done:x", "social_daily_attempt:linkedin", "social_daily_done:linkedin", "social_daily_attempt:reddit", "social_daily_done:reddit"];
  const leadProfile = JSON.stringify({ version: 1, roles: ["Founder"], industries: ["B2B SaaS"], sizes: ["11-50"], locations: ["Europe"], problem: "Freelancers lose hours every month chasing late invoices.", exclude: [], webRelated: false, confirmedAt: iso(now - 20 * DAY) });
  const unconfirmedProfile = JSON.stringify({ version: 1, roles: ["Founder"], industries: ["B2B SaaS"], sizes: [], locations: [], problem: "", exclude: [], webRelated: false, confirmedAt: null });

  for (let u = 0; u < cfg.users; u++) {
    const uid = userId(u);
    T.profiles.add({ id: uid, email: `user${u}@example.test`, name: `User ${u}`, plan_tier: "free", credits_balance: 100, created_at: iso(now - 200 * DAY), updated_at: iso(now - DAY) });
    T.settings.add({ user_id: uid, key: "active_project_id", value: projectId(u * cfg.projectsPerUser), updated_at: iso(now - DAY) });
    for (let n = 0; n < 30; n++) {
      T.notes.add({
        id: `33333333-3333-4333-8333-${hex12(u * 100 + n)}`, user_id: uid, project_id: projectId(u * cfg.projectsPerUser), kind: kinds[n % kinds.length],
        dedupe_key: `seed:${n}`, title: `Notification ${n}`, body: "Something changed on your site and is worth a look.", payload: {}, created_at: iso(now - n * 2 * DAY),
        read_at: n % 3 === 0 ? null : iso(now - n * DAY), emailed_at: null, email_error: null, email_attempts: 0, last_email_attempt_at: null,
      });
    }
  }

  for (let g = 0; g < N; g++) {
    const u = Math.floor(g / cfg.projectsPerUser);
    const uid = userId(u), pid = projectId(g);
    const tr = traits(g);
    const created = now - (60 + (g % 140)) * DAY;
    T.projects.add({
      id: pid, owner_id: uid, name: `Project ${g}`, category: "SaaS", description: "Invoicing software for freelancers.", url: `https://site${g}.example.test`,
      created_at: iso(created), updated_at: iso(created + 5 * DAY),
      leads_auto_last_at: tr.leadsDue ? (g % 3 === 0 ? null : iso(now - (30 + (g % 40)) * 3600_000)) : iso(now - 3 * 3600_000),
    });
    if (tr.github) T.settings.add({ user_id: uid, key: `github_app:${pid}`, value: "1", updated_at: iso(now) });

    // documents: 5 context docs (+ lead profile, automation settings) and the cron markers
    docTypes.forEach((dt, i) =>
      T.docs.add({ user_id: uid, project_id: pid, doc_type: dt, status: "ready", content: docPool[(g + i) % docPool.length], created_at: iso(created + i * 60_000), updated_at: iso(created + 7 * DAY) }),
    );
    T.docs.add({ user_id: uid, project_id: pid, doc_type: "lead_profile", status: "ready", content: tr.hasProfile ? leadProfile : unconfirmedProfile, created_at: iso(created + 10 * 60_000), updated_at: iso(created + DAY) });
    if (tr.optedIn) {
      T.docs.add({ user_id: uid, project_id: pid, doc_type: "automation_settings", status: "ready", content: '{"autoPropose":true,"social":true}', created_at: iso(created + 20 * 60_000), updated_at: iso(created + DAY) });
      const perDay = markerTypes.length;
      for (let d = 0; d < Math.ceil(cfg.markersPerProject / perDay); d++) {
        const day = dayStr(now - (d + 1) * DAY);
        for (let k = 0; k < perDay && d * perDay + k < cfg.markersPerProject; k++) {
          const mt = markerTypes[k];
          const doc_type = mt === "auto_propose_done" ? `${mt}:${day}` : mt.replace(/^(social_daily_\w+):/, `$1:${day}:`);
          T.docs.add({ user_id: uid, project_id: pid, doc_type, status: "done", content: '{"at":"' + day + '"}', created_at: iso(now - (d + 1) * DAY + k * 1000), updated_at: iso(now - (d + 1) * DAY + k * 1000) });
        }
      }
    }

    for (let c = 0; c < 5; c++) T.comps.add({ id: `44444444-4444-4444-8444-${hex12(g * 10 + c)}`, user_id: uid, project_id: pid, url: `https://competitor-${c}.example.test`, created_at: iso(created + c * 1000) });

    const nAudits = g % 3 === 0 ? 3 : 1;
    for (let a = 0; a < nAudits; a++) {
      T.audits.add({ id: `55555555-5555-4555-8555-${hex12(g * 10 + a)}`, user_id: uid, project_id: pid, url: `https://site${g}.example.test/${a ? `page-${a}` : ""}`, payload: auditTemplates[(g + a) % 4], created_at: iso(now - (a + 1) * DAY) });
    }

    for (let f = 0; f < cfg.findingsPerProject; f++) {
      T.findings.add({
        id: `66666666-6666-4666-8666-${hex12(g * 100 + f)}`, user_id: uid, project_id: pid, source: "seo", category: ["meta-description", "title", "headings", "links"][f % 4],
        severity: ["info", "warning", "critical"][f % 3], entity_type: "page", entity_id: `/page-${f}`, url: `https://site${g}.example.test/page-${f}`,
        evidence: evidencePool[0], recommendation: rec, status: f % 6 === 0 ? "fixed" : "new", first_seen: iso(now - 40 * DAY), last_seen: iso(now - (f % 10) * DAY), resolved_at: null,
      });
    }

    for (let l = 0; l < cfg.leadsPerProject; l++) {
      const k = (g * 7 + l) % names.length;
      T.leads.add({
        id: `77777777-7777-4777-8777-${hex12(g * 1000 + l)}`, user_id: uid, project_id: pid, name: names[k], title: titles[k % 4], company: companies[k % 100], location: locations[k % 4],
        email: l % 3 ? `person${k}@company${k % 100}.example.test` : null, email_verified: l % 2 === 0, source_url: `https://www.example-source-${k}.com/some/path/index.html`,
        query: "saas founders in europe", phone: null, place_id: null, lead_type: "person", email_status: l % 5 === 0 ? "sent" : null, emailed_at: null, gmail_thread_id: null, gmail_message_id: null,
        last_reply_at: null, last_reply_snippet: null, created_at: iso(now - (l % 90) * DAY - l * 1000), scope: "customer", email_quality: null, dedupe_key: null, auto_generated: l % 2 === 1, tags: [], notes: null,
        reply_classification: null, unsubscribed_at: null,
      });
    }

    if (tr.hasGsc) {
      const cid = connId(g, 0);
      T.conns.add({
        id: cid, user_id: uid, project_id: pid, provider: "gsc", status: tr.gscBroken ? "needs_reconnect" : "connected", last_error_code: tr.gscBroken ? "invalid_grant" : null, last_error_at: null,
        token_expiry: iso(now + 3600_000), scopes: [], external_email: `user${u}@example.test`, external_property: null, created_at: iso(created), updated_at: iso(created),
        access_token_secret_id: `88888888-8888-4888-8888-${hex12(g * 2)}`, refresh_token_secret_id: `88888888-8888-4888-8888-${hex12(g * 2 + 1)}`,
      });
      if (!tr.gscNoProperty) {
        T.res.add({ id: `99999999-9999-4999-8999-${hex12(g)}`, connection_id: cid, user_id: uid, resource_type: "search_console_property", resource_id: `sc-domain:site${g}.example.test`, resource_name: `site${g}.example.test`, metadata: {}, selected: true, created_at: iso(created) });
      }
      for (let d = 1; d <= cfg.snapshotDays; d++) {
        T.snaps.add({ project_id: pid, user_id: uid, snapshot_date: dayStr(now - d * DAY), payload: snapshotPayload, captured_at: iso(now - d * DAY + 3 * 3600_000) });
      }
      // geo: 10 tracked prompts, one weekly run each for geoWeeks weeks (none in the current week)
      for (let p = 0; p < 10; p++) {
        const prompt = `what is the best tool for use case ${p}?`;
        T.prompts.add({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${hex12(g * 10 + p)}`, project_id: pid, user_id: uid, prompt, source: p < 8 ? "gsc" : "manual", active: true, created_at: iso(created + p * 1000) });
        for (let w = 1; w <= cfg.geoWeeks; w++) {
          T.runs.add({ id: `bbbbbbbb-bbbb-4bbb-8bbb-${hex12(g * 10000 + p * 100 + w)}`, project_id: pid, user_id: uid, prompt, engine: "tavily+groq", method: "simulated", run_at: iso(now - (w * 7 + 1) * DAY), mentioned: (g + p + w) % 3 === 0, cited: (g + p + w) % 5 === 0, competitors: [], sources, answer_excerpt: excerpt });
        }
        if (tr.heavyGeo) {
          // manual runners: 3x per day for the last 50 days -> well past the 1000-row PostgREST cap
          for (let x = 0; x < 150; x++) {
            T.runs.add({ id: `cccccccc-cccc-4ccc-8ccc-${hex12(g * 10000 + p * 200 + x)}`, project_id: pid, user_id: uid, prompt, engine: "gemini-grounded", method: "gemini-grounded", run_at: iso(now - (x % 50) * DAY - x * 60_000), mentioned: x % 2 === 0, cited: x % 3 === 0, competitors: [], sources, answer_excerpt: excerpt });
          }
        }
      }
    }
  }
  return N;
}

