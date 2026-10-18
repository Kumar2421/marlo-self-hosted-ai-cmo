import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { ensureXDraftColumns } from "@/lib/domain/x/xDraftStore";

/** Additive columns on the linkedin_drafts table; safe to run on every startup. */
function ensureLinkedInDraftColumns(db: Database.Database): void {
  const cols = (db.prepare("PRAGMA table_info(linkedin_drafts)").all() as { name: string }[]).map((c) => c.name);
  const add = (name: string, ddl: string) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE linkedin_drafts ADD COLUMN ${name} ${ddl}`);
  };
  add("project_id", "TEXT");
  add("angle", "TEXT");
  add("why_this_works", "TEXT");
  add("edited", "INTEGER NOT NULL DEFAULT 0");
  add("completed_at", "TEXT");
  add("batch_id", "TEXT");
}

/** Additive columns on the reddit_post_drafts table; safe to run on every startup. */
function ensureRedditPostDraftColumns(db: Database.Database): void {
  const cols = (db.prepare("PRAGMA table_info(reddit_post_drafts)").all() as { name: string }[]).map((c) => c.name);
  const add = (name: string, ddl: string) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE reddit_post_drafts ADD COLUMN ${name} ${ddl}`);
  };
  // All columns should exist from initial CREATE TABLE, but ensure idempotency
  add("project_id", "TEXT");
  add("angle", "TEXT");
  add("why_this_works", "TEXT");
  add("edited", "INTEGER NOT NULL DEFAULT 0");
  add("batch_id", "TEXT");
  add("completed_at", "TEXT");
}

/**
 * Local SQLite persistence — chosen over a hosted DB (Supabase/Postgres) for now:
 * zero external services, single portable file, survives restarts, and if this
 * project becomes an Electron app later, this file just ships alongside the app
 * with no re-architecture needed. Swap for Postgres later only if multi-device
 * sync or multi-user access actually requires a server-side DB.
 *
 * Single global connection — Next.js dev mode hot-reloads modules, so stash the
 * instance on `globalThis` to avoid opening a new file handle on every reload.
 */

declare global {
  // eslint-disable-next-line no-var
  var __okaraDb: Database.Database | undefined;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "okara.db");

function init(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_connections (
      provider_id   TEXT PRIMARY KEY,
      api_key       TEXT NOT NULL DEFAULT '',
      connected_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS articles (
      id         TEXT PRIMARY KEY,
      topic      TEXT NOT NULL,
      keywords   TEXT NOT NULL,
      brandVoice TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seo_audits (
      url        TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hn_drafts (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      status      TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reddit_opportunities (
      id           TEXT PRIMARY KEY,
      subreddit    TEXT NOT NULL,
      title        TEXT NOT NULL,
      body         TEXT NOT NULL,
      reply_draft  TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS x_drafts (
      id          TEXT PRIMARY KEY,
      topic       TEXT NOT NULL,
      body        TEXT NOT NULL,
      status      TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS linkedin_drafts (
      id          TEXT PRIMARY KEY,
      topic       TEXT NOT NULL,
      body        TEXT NOT NULL,
      status      TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reddit_post_drafts (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      subreddit   TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      status      TEXT NOT NULL,
      angle       TEXT,
      why_this_works TEXT,
      edited      INTEGER NOT NULL DEFAULT 0,
      batch_id    TEXT,
      completed_at TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS github_prs (
      id           TEXT PRIMARY KEY,
      repo         TEXT NOT NULL,
      title        TEXT NOT NULL,
      description  TEXT NOT NULL,
      diff_summary TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    -- Real multi-project support: each row is one saved project (own
    -- id/name/url). Which one is "active" (used by Context, Analytics, and
    -- every agent) is tracked separately via settings.active_project_id —
    -- see lib/domain/shared/getActiveProjectId.ts. Legacy rows created
    -- before that pointer existed used the literal id 'active'; that still
    -- works as a fallback, it's just an ordinary row now.
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      url         TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- AI-generated strategy documents (Product Information, Marketing
    -- Strategy, etc. — see okara.ai's real Context panel). project_id
    -- matches projects.id ('active' for now, same single-project caveat).
    -- One row per doc_type per project — regenerating replaces content and
    -- bumps updated_at rather than versioning, for now.
    CREATE TABLE IF NOT EXISTS project_documents (
      project_id TEXT NOT NULL,
      doc_type   TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'ready',
      content    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, doc_type)
    );

    -- Competitor URLs per project — either added manually or by the real
    -- discovery agent (CompetitorDiscoveryAgent, web-search-grounded or
    -- crawl-context-only, every candidate verified by a real fetch).
    CREATE TABLE IF NOT EXISTS project_competitors (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      url        TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Cached result of the real bounded link-reachability check (Analytics →
    -- Links tab) — an explicit, user-triggered action, not run on every audit.
    CREATE TABLE IF NOT EXISTS link_checks (
      project_id TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );

    -- Cached result of the real Tavily-backed GEO citation-gap check
    -- (Analytics → GEO tab) — same reasoning: explicit action, not automatic,
    -- since it spends real Tavily credits.
    CREATE TABLE IF NOT EXISTS geo_checks (
      project_id TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );

    -- Cached result of the real multi-page site crawl (SiteCrawlAgent) —
    -- explicit action, not automatic (each page can cost a real Jina render).
    CREATE TABLE IF NOT EXISTS site_crawls (
      project_id TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );

    -- Cached result of the real Traffic tab fetch (GSC + GA4) — written
    -- every time a user opens the Traffic tab. Exists so the chat agent can
    -- read real traffic context cheaply (no live Google API round-trip on
    -- every chat message) — see lib/domain/shared/trafficContextPrompt.ts.
    CREATE TABLE IF NOT EXISTS traffic_checks (
      project_id TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );

    -- One compact Search Console snapshot per project per day (see
    -- lib/domain/search/searchSnapshot.ts). History is what trends and
    -- before/after impact are computed from; pruned on every save.
    CREATE TABLE IF NOT EXISTS search_snapshots (
      project_id    TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      payload       TEXT NOT NULL,
      captured_at   TEXT NOT NULL,
      PRIMARY KEY (project_id, snapshot_date)
    );

    -- GEO / AI-visibility history (twin of supabase geo_runs / geo_prompts).
    -- Every run is tagged with the method that produced it; see lib/domain/geo/types.ts.
    CREATE TABLE IF NOT EXISTS geo_prompts (
      project_id TEXT NOT NULL,
      prompt     TEXT NOT NULL,
      source     TEXT NOT NULL,
      active     INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (project_id, prompt)
    );
    CREATE TABLE IF NOT EXISTS geo_runs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id     TEXT NOT NULL,
      prompt         TEXT NOT NULL,
      engine         TEXT NOT NULL,
      method         TEXT NOT NULL,
      run_at         TEXT NOT NULL,
      mentioned      INTEGER NOT NULL DEFAULT 0,
      cited          INTEGER NOT NULL DEFAULT 0,
      competitors    TEXT NOT NULL DEFAULT '[]',
      sources        TEXT NOT NULL DEFAULT '[]',
      answer_excerpt TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS geo_runs_project_run_at_idx ON geo_runs (project_id, run_at);
    -- Daily call slots reserved per method (failed calls count) and a per-project in-flight lock.
    CREATE TABLE IF NOT EXISTS geo_usage (
      method TEXT NOT NULL,
      day    TEXT NOT NULL,
      used   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (method, day)
    );
    CREATE TABLE IF NOT EXISTS geo_locks (
      project_id   TEXT PRIMARY KEY,
      locked_until INTEGER NOT NULL
    );

    -- Marlo's own notifications (single local user, so user_id is always
    -- 'local'; kept so the shape matches the platform tables).
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id          TEXT PRIMARY KEY,
      prefs            TEXT NOT NULL DEFAULT '{}',
      unsubscribed_all INTEGER NOT NULL DEFAULT 0,
      updated_at       TEXT NOT NULL,
      last_run_at      TEXT,
      last_test_email_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      project_id  TEXT,
      kind        TEXT NOT NULL,
      dedupe_key  TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      payload     TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL,
      read_at     TEXT,
      emailed_at  TEXT,
      email_error TEXT,
      email_attempts INTEGER NOT NULL DEFAULT 0,
      last_email_attempt_at TEXT,
      UNIQUE (user_id, dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);

    -- Real leads (outreach prospects) — row-per-lead, not a JSON blob, since
    -- per-row state (email sent/not, notes) is coming in a later phase. Every
    -- row must carry a real source_url it was extracted from; email is
    -- nullable and stays null rather than ever being invented.
    CREATE TABLE IF NOT EXISTS project_integrations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      integration_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'connected',
      account_identifier TEXT,
      connected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, integration_type)
    );

    CREATE TABLE IF NOT EXISTS integration_secrets (
      integration_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integration_resources (
      id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_name TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      selected INTEGER NOT NULL DEFAULT 0,
      UNIQUE(integration_id, resource_type, resource_id)
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      return_to TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS findings (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL,
      source       TEXT NOT NULL,
      category     TEXT NOT NULL,
      severity     TEXT NOT NULL,
      entity_type  TEXT NOT NULL,
      entity_id    TEXT NOT NULL,
      url          TEXT,
      evidence     TEXT NOT NULL DEFAULT '{}',
      recommendation TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'new',
      first_seen   TEXT NOT NULL,
      last_seen    TEXT NOT NULL,
      resolved_at  TEXT,
      UNIQUE(project_id, source, category, entity_type, entity_id, url)
    );

    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      recommendation_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      title TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '{}',
      parameters TEXT NOT NULL DEFAULT '{}',
      result TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS actions_project_created_idx ON actions(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS actions_project_finding_idx ON actions(project_id, finding_id);

    CREATE TABLE IF NOT EXISTS leads (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name       TEXT NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      company    TEXT NOT NULL DEFAULT '',
      location   TEXT NOT NULL DEFAULT '',
      email      TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      source_url TEXT,
      query      TEXT NOT NULL DEFAULT '',
      -- Local Business mode (Places API) fields — null for person leads.
      phone      TEXT,
      place_id   TEXT,
      lead_type  TEXT NOT NULL DEFAULT 'person',
      -- Gmail send phase — null until a real send is attempted.
      email_status TEXT,
      emailed_at   TEXT,
      -- Gmail reply-tracking phase — null until a reply is detected via a
      -- real inbox poll (gmail_thread_id set at send time, the rest filled
      -- in the first time listReplies() finds something new).
      gmail_thread_id     TEXT,
      gmail_message_id    TEXT,
      last_reply_at       TEXT,
      last_reply_snippet  TEXT,
      created_at TEXT NOT NULL
    );

    -- Real memory for the code-fix agent — one row per (project, finding),
    -- not a vector store (finding count per project is small, exact-match
    -- lookup is all that's needed). Prevents re-suggesting a fix that's
    -- already a real open/merged PR, and respects a human's "rejected" call
    -- by never auto-retrying it. See lib/domain/codefix/.
    CREATE TABLE IF NOT EXISTS code_fixes (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      issue_id   TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'proposed',
      pr_url     TEXT,
      file_path  TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, issue_id)
    );
  `);

  migrate(db);

  return db;
}

/** ALTER TABLE for columns added after initial release — CREATE TABLE IF NOT
 * EXISTS above only helps fresh installs, existing okara.db files on disk
 * need these run explicitly. Each guarded by a columns-list check so it's
 * safe to run on every startup. */
function migrate(db: Database.Database) {
  ensureXDraftColumns(db);
  ensureLinkedInDraftColumns(db);
  ensureRedditPostDraftColumns(db);

  // Notification bookkeeping columns added while the feature was in review.
  const addMissing = (table: string, columns: Array<[string, string]>) => {
    const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const [name, type] of columns) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  };
  addMissing("notification_preferences", [["last_run_at", "TEXT"], ["last_test_email_at", "TEXT"]]);
  addMissing("notifications", [["email_attempts", "INTEGER NOT NULL DEFAULT 0"], ["last_email_attempt_at", "TEXT"]]);

  const cols = db.prepare("PRAGMA table_info(provider_connections)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "base_url")) {
    db.exec(`ALTER TABLE provider_connections ADD COLUMN base_url TEXT`);
  }

  // Migrate the legacy global Google connection only when ownership is unambiguous.
  // Multiple projects must never receive credentials silently.
  const legacy = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('ga_access_token','ga_refresh_token','ga_token_expiry','ga_email','gsc_site_url','ga_property_id','ga_property_name')"
  ).all() as { key: string; value: string }[];
  const legacyMap = Object.fromEntries(legacy.map((row) => [row.key, row.value]));
  const projectRows = db.prepare("SELECT id FROM projects ORDER BY updated_at DESC").all() as { id: string }[];
  const hasIntegrations = db.prepare("SELECT 1 FROM project_integrations LIMIT 1").get();

  if (!hasIntegrations && legacyMap.ga_refresh_token && projectRows.length === 1) {
    const projectId = projectRows[0].id;
    const now = new Date().toISOString();
    const baseId = "int_legacy_google";
    db.prepare(
      `INSERT OR IGNORE INTO project_integrations
        (id, project_id, provider, integration_type, status, account_identifier, connected_at, updated_at)
       VALUES (?, ?, 'google', 'google-search-console', 'connected', ?, ?, ?)`
    ).run(baseId + "_gsc", projectId, legacyMap.ga_email ?? null, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO project_integrations
        (id, project_id, provider, integration_type, status, account_identifier, connected_at, updated_at)
       VALUES (?, ?, 'google', 'google-analytics', 'connected', ?, ?, ?)`
    ).run(baseId + "_ga4", projectId, legacyMap.ga_email ?? null, now, now);

    const gscId = baseId + "_gsc";
    const ga4Id = baseId + "_ga4";
    db.prepare(
      "INSERT OR REPLACE INTO integration_secrets (integration_id, access_token, refresh_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(gscId, legacyMap.ga_access_token ?? "", legacyMap.ga_refresh_token, Number(legacyMap.ga_token_expiry ?? 0), now);
    db.prepare(
      "INSERT OR REPLACE INTO integration_secrets (integration_id, access_token, refresh_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(ga4Id, legacyMap.ga_access_token ?? "", legacyMap.ga_refresh_token, Number(legacyMap.ga_token_expiry ?? 0), now);

    if (legacyMap.gsc_site_url) {
      db.prepare(
        "INSERT OR REPLACE INTO integration_resources (id, integration_id, resource_type, resource_id, resource_name, metadata, selected) VALUES (?, ?, 'search_console_property', ?, ?, '{}', 1)"
      ).run("res_legacy_gsc", gscId, legacyMap.gsc_site_url, legacyMap.gsc_site_url);
    }
    if (legacyMap.ga_property_id) {
      db.prepare(
        "INSERT OR REPLACE INTO integration_resources (id, integration_id, resource_type, resource_id, resource_name, metadata, selected) VALUES (?, ?, 'ga4_property', ?, ?, '{}', 1)"
      ).run("res_legacy_ga4", ga4Id, legacyMap.ga_property_id, legacyMap.ga_property_name ?? legacyMap.ga_property_id);
    }

    for (const key of Object.keys(legacyMap)) {
      db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    }
  }

  const leadsCols = db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
  if (leadsCols.length > 0) {
    if (!leadsCols.some((c) => c.name === "email_verified")) {
      db.exec(`ALTER TABLE leads ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`);
    }
    if (!leadsCols.some((c) => c.name === "phone")) {
      db.exec(`ALTER TABLE leads ADD COLUMN phone TEXT`);
    }
    if (!leadsCols.some((c) => c.name === "place_id")) {
      db.exec(`ALTER TABLE leads ADD COLUMN place_id TEXT`);
    }
    if (!leadsCols.some((c) => c.name === "lead_type")) {
      db.exec(`ALTER TABLE leads ADD COLUMN lead_type TEXT NOT NULL DEFAULT 'person'`);
    }
    if (!leadsCols.some((c) => c.name === "email_status")) {
      db.exec(`ALTER TABLE leads ADD COLUMN email_status TEXT`);
    }
    if (!leadsCols.some((c) => c.name === "emailed_at")) {
      db.exec(`ALTER TABLE leads ADD COLUMN emailed_at TEXT`);
    }
    if (!leadsCols.some((c) => c.name === "gmail_thread_id")) {
      db.exec(`ALTER TABLE leads ADD COLUMN gmail_thread_id TEXT`);
    }
    if (!leadsCols.some((c) => c.name === "gmail_message_id")) {
      db.exec(`ALTER TABLE leads ADD COLUMN gmail_message_id TEXT`);
    }
    if (!leadsCols.some((c) => c.name === "last_reply_at")) {
      db.exec(`ALTER TABLE leads ADD COLUMN last_reply_at TEXT`);
    }
    if (!leadsCols.some((c) => c.name === "last_reply_snippet")) {
      db.exec(`ALTER TABLE leads ADD COLUMN last_reply_snippet TEXT`);
    }
    // Local business mode (Places + website enrichment). Mirrors the Supabase migration 20261017000000.
    const localLeadColumns: [string, string][] = [
      ["address", "TEXT"],
      ["website", "TEXT"],
      ["rating", "REAL"],
      ["review_count", "INTEGER"],
      ["whatsapp", "TEXT"],
      ["contact_url", "TEXT"],
      ["description", "TEXT"],
      ["maps_url", "TEXT"],
      ["fit_reason", "TEXT"],
      ["fit_score", "REAL"],
      ["enrichment_status", "TEXT"],
      ["email_quality", "TEXT"],
    ];
    for (const [column, type] of localLeadColumns) {
      if (!leadsCols.some((c) => c.name === column)) {
        db.exec(`ALTER TABLE leads ADD COLUMN ${column} ${type}`);
      }
    }
    // One saved row per Google place per project. If an older install already has duplicate
    // place rows the index cannot be built; the places-search route still pre-filters known ids.
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS leads_project_place_uidx ON leads (project_id, place_id) WHERE place_id IS NOT NULL`);
    } catch {
      // existing duplicate place rows: leave the index out rather than fail startup
    }
  }

  const articlesCols = db.prepare("PRAGMA table_info(articles)").all() as { name: string }[];
  if (articlesCols.length > 0) {
    if (!articlesCols.some((c) => c.name === "title")) {
      db.exec(`ALTER TABLE articles ADD COLUMN title TEXT`);
    }
    if (!articlesCols.some((c) => c.name === "status")) {
      db.exec(`ALTER TABLE articles ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'`);
    }
    if (!articlesCols.some((c) => c.name === "published_url")) {
      db.exec(`ALTER TABLE articles ADD COLUMN published_url TEXT`);
    }
    if (!articlesCols.some((c) => c.name === "pr_url")) {
      db.exec(`ALTER TABLE articles ADD COLUMN pr_url TEXT`);
    }
    if (!articlesCols.some((c) => c.name === "published_at")) {
      db.exec(`ALTER TABLE articles ADD COLUMN published_at TEXT`);
    }
  }
}

export function getDb(): Database.Database {
  if (!global.__okaraDb) {
    global.__okaraDb = init();
  }
  return global.__okaraDb;
}
