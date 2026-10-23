import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { OutreachNotSetUpError, type OutreachStore } from "./outreachStore.ts";

function run<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) throw new OutreachNotSetUpError();
    throw err;
  }
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** Self-host (SQLite) outreach store. Takes the database explicitly so tests can use an in-memory one. */
export function sqliteOutreachStore(db: Database.Database): OutreachStore {
  return {
    async optedOut(userId, emails) {
      if (emails.length === 0) return new Set();
      const rows = run(() =>
        db.prepare(`SELECT email FROM outreach_optouts WHERE user_id = ? AND email IN (${marks(emails.length)})`).all(userId, ...emails),
      ) as { email: string }[];
      return new Set(rows.map((r) => r.email));
    },
    async lastSends(userId, emails, since) {
      const out = new Map<string, Date>();
      if (emails.length === 0) return out;
      const rows = run(() =>
        db
          .prepare(
            `SELECT email, MAX(sent_at) AS last FROM outreach_sends WHERE user_id = ? AND sent_at >= ? AND email IN (${marks(emails.length)}) GROUP BY email`,
          )
          .all(userId, since.toISOString(), ...emails),
      ) as { email: string; last: string }[];
      for (const r of rows) out.set(r.email, new Date(r.last));
      return out;
    },
    async countSince(userId, since) {
      const row = run(() =>
        db.prepare("SELECT COUNT(*) AS n FROM outreach_sends WHERE user_id = ? AND sent_at >= ?").get(userId, since.toISOString()),
      ) as { n: number };
      return row.n;
    },
    async recordSend(r) {
      run(() =>
        db
          .prepare("INSERT INTO outreach_sends (id, user_id, project_id, lead_id, email, sent_at, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(randomUUID(), r.userId, r.projectId, r.leadId, r.email, r.sentAt.toISOString(), r.messageId),
      );
    },
    async addOptout(userId, email, reason, at = new Date()) {
      run(() =>
        db
          .prepare("INSERT OR IGNORE INTO outreach_optouts (user_id, email, reason, created_at) VALUES (?, ?, ?, ?)")
          .run(userId, email, reason, at.toISOString()),
      );
    },
  };
}
