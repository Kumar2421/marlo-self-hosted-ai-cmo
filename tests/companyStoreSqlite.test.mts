import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { insertCompanyLeads } from "../lib/domain/leads/company/companyStoreSqlite.ts";

function db() {
  const d = new Database(":memory:");
  d.exec(`CREATE TABLE leads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '', email TEXT, email_verified INTEGER NOT NULL DEFAULT 0, source_url TEXT, query TEXT NOT NULL DEFAULT '', lead_type TEXT NOT NULL DEFAULT 'person',
    created_at TEXT NOT NULL, whatsapp TEXT, contact_url TEXT, description TEXT, email_quality TEXT, fit_reason TEXT, website TEXT)`);
  return d;
}

const row = { name: "Smile Dental", email: "hi@smile.test", email_quality: "source_found", whatsapp: null, contact_url: "https://smile.test/contact", website: "https://smile.test/", description: "d", source_url: "https://smile.test/contact", fit_reason: "Company site mentions dental.", lead_type: "company", query: "q", created_at: "2026-11-06T00:00:00Z", extra: "ignored" };

test("saves company leads with their reason, source and quality, and returns ids", () => {
  const d = db();
  const saved = insertCompanyLeads(d, "p1", [row, { ...row, name: "B", website: "https://b.test/" }]);
  assert.equal(saved.length, 2);
  const r = d.prepare("SELECT * FROM leads WHERE name = 'Smile Dental'").get() as Record<string, unknown>;
  assert.equal(r.lead_type, "company");
  assert.equal(r.fit_reason, "Company site mentions dental.");
  assert.equal(r.email_verified, 0);
  assert.equal(r.company, "Smile Dental");
  assert.equal(r.project_id, "p1");
});

test("a failure part-way saves nothing", () => {
  const d = db();
  assert.throws(() => insertCompanyLeads(d, "p1", [row, { ...row, name: null }]));
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number }).n, 0);
});
