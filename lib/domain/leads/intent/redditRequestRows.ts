import { statusFromTags } from "../local/businessLead.ts";
import { canonicalPostUrl, subredditOf } from "./redditPosts.ts";

/**
 * The Social page's Reddit "Replies" list, built from saved requests (leads of type "intent"). Pure: the panel only
 * renders what these functions return, so ordering, status and wording are unit-tested.
 */

export type RequestStatus = "new" | "posted" | "dismissed";

export type RequestLead = {
  id: string;
  name: string;
  company?: string | null;
  lead_type?: string | null;
  source_url?: string | null;
  fit_reason?: string | null;
  description?: string | null;
  tags?: readonly string[] | null;
  created_at?: string | null;
};

export type RequestRow = {
  id: string;
  title: string;
  subreddit: string;
  /** Canonical post address, or null when the saved address is not a Reddit post. */
  url: string | null;
  /** The words in the post that show the ask. */
  quote: string;
  /** The saved reply draft; empty when none was drafted (the panel then offers a template). */
  reply: string;
  status: RequestStatus;
  createdAt: string;
};

function quoteFrom(reason: string | null | undefined): string {
  const m = /Asked on r\/[A-Za-z0-9_]+: "([^"]+)"/.exec(reason ?? "");
  return m ? m[1] : "";
}

function statusOf(tags: readonly string[] | null | undefined): RequestStatus {
  const s = statusFromTags(tags);
  if (s === "contacted" || s === "replied") return "posted";
  if (s === "not_interested") return "dismissed";
  return "new";
}

/** Requests only, newest first. Anything that is not a request with a Reddit post address is left out. */
export function toRequestRows(leads: readonly RequestLead[]): RequestRow[] {
  const rows: RequestRow[] = [];
  for (const l of leads) {
    if (l.lead_type !== "intent") continue;
    const subreddit = subredditOf(l.source_url) ?? (l.company ?? "").replace(/^r\//i, "");
    if (!subreddit) continue;
    rows.push({
      id: l.id,
      title: l.name,
      subreddit,
      url: canonicalPostUrl(l.source_url),
      quote: quoteFrom(l.fit_reason),
      reply: (l.description ?? "").trim(),
      status: statusOf(l.tags),
      createdAt: l.created_at ?? "",
    });
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type RequestGroups = { toAnswer: RequestRow[]; posted: RequestRow[] };

/** To answer = new requests. Posted = the user said they posted. Dismissed requests are hidden. */
export function groupRequests(rows: readonly RequestRow[]): RequestGroups {
  return { toAnswer: rows.filter((r) => r.status === "new"), posted: rows.filter((r) => r.status === "posted") };
}

export function rulesUrl(subreddit: string): string {
  return `https://www.reddit.com/r/${subreddit.replace(/^r\//i, "")}/about/rules`;
}

/** "Found today", "Found yesterday", "Found 3 days ago". Unknown or future dates read as today. */
export function foundLabel(createdAt: string, now: Date = new Date()): string {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return "Found recently";
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days <= 0) return "Found today";
  if (days === 1) return "Found yesterday";
  return `Found ${days} days ago`;
}

export function formatRepliesToAnswer(count: number): string {
  if (count <= 0) return "No replies to answer";
  return count === 1 ? "1 reply to answer" : `${count} replies to answer`;
}
