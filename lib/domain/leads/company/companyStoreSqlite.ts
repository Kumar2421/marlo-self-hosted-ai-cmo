import type Database from "better-sqlite3";

type Row = Record<string, unknown>;

/** Saves company leads (lead_type "company") into the local leads table in one transaction. Returns the saved rows with ids. */
export function insertCompanyLeads(db: Database.Database, projectId: string, rows: Row[]): Row[] {
  const insert = db.prepare(
    `INSERT INTO leads (id, project_id, name, title, company, location, email, email_verified, email_quality, whatsapp, contact_url, website, description, source_url, fit_reason, lead_type, query, created_at)
     VALUES (@id, @project_id, @name, @title, @company, '', @email, 0, @email_quality, @whatsapp, @contact_url, @website, @description, @source_url, @fit_reason, @lead_type, @query, @created_at)`,
  );
  const run = db.transaction((items: Row[]) =>
    items.map((r) => {
      const id = `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const params = {
        id, project_id: projectId, name: r.name, title: r.title ?? "", company: r.company ?? r.name, email: r.email ?? null,
        email_quality: r.email_quality ?? null, whatsapp: r.whatsapp ?? null, contact_url: r.contact_url ?? null, website: r.website ?? null,
        description: r.description ?? null, source_url: r.source_url ?? null, fit_reason: r.fit_reason ?? null, lead_type: r.lead_type ?? "company",
        query: r.query ?? "", created_at: r.created_at,
      };
      insert.run(params);
      return { ...r, ...params, email_verified: 0 };
    }),
  );
  return run(rows);
}
