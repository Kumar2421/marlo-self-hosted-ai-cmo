/**
 * Persistence port for outreach safeguards: the stop list (outreach_optouts) and the send log
 * (outreach_sends). Implementations: in-memory (tests), SQLite (self-host), Supabase (outreachStoreSupabase.ts).
 * Every method rejects with OutreachNotSetUpError when the tables do not exist yet; callers must then refuse to
 * send rather than send without the guard.
 */

export type OptoutReason = "unsubscribed" | "reply_stop";

export type OutreachSendRecord = {
  userId: string;
  projectId: string | null;
  leadId: string | null;
  /** Lowercased. */
  email: string;
  sentAt: Date;
  messageId: string | null;
};

export interface OutreachStore {
  /** Which of `emails` (lowercased) the user may never email again. */
  optedOut(userId: string, emails: string[]): Promise<Set<string>>;
  /** Most recent send per address, for sends at or after `since`. */
  lastSends(userId: string, emails: string[], since: Date): Promise<Map<string, Date>>;
  /** Sends by this user at or after `since`, across all projects. */
  countSince(userId: string, since: Date): Promise<number>;
  recordSend(record: OutreachSendRecord): Promise<void>;
  /** Idempotent. */
  addOptout(userId: string, email: string, reason: OptoutReason, at?: Date): Promise<void>;
}

export class OutreachNotSetUpError extends Error {
  constructor() {
    super("Outreach safeguards are not set up yet");
    this.name = "OutreachNotSetUpError";
  }
}

/** In-memory store for tests. `missing: true` simulates the tables not existing. */
export function memoryOutreachStore(opts: { missing?: boolean } = {}) {
  const optouts = new Map<string, Map<string, OptoutReason>>();
  const sends: OutreachSendRecord[] = [];
  const guard = () => {
    if (opts.missing) throw new OutreachNotSetUpError();
  };
  const store: OutreachStore & { optouts: typeof optouts; sends: typeof sends } = {
    optouts,
    sends,
    async optedOut(userId, emails) {
      guard();
      const mine = optouts.get(userId);
      return new Set(emails.filter((e) => mine?.has(e)));
    },
    async lastSends(userId, emails, since) {
      guard();
      const out = new Map<string, Date>();
      for (const s of sends) {
        if (s.userId !== userId || !emails.includes(s.email) || s.sentAt < since) continue;
        const prev = out.get(s.email);
        if (!prev || s.sentAt > prev) out.set(s.email, s.sentAt);
      }
      return out;
    },
    async countSince(userId, since) {
      guard();
      return sends.filter((s) => s.userId === userId && s.sentAt >= since).length;
    },
    async recordSend(record) {
      guard();
      sends.push(record);
    },
    async addOptout(userId, email, reason) {
      guard();
      const m = optouts.get(userId) ?? new Map<string, OptoutReason>();
      if (!m.has(email)) m.set(email, reason);
      optouts.set(userId, m);
    },
  };
  return store;
}
