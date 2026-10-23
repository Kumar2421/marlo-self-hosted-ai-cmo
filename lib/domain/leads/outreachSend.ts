import {
  isOutreachTemplateId,
  outreachCreditCost,
  type OutreachBlockReason,
  type OutreachPlanResponse,
  type OutreachSendRequest,
  type OutreachSendResult,
  type OutreachStatus,
} from "./outreachContract.ts";
import { renderOutreachEmail } from "./outreachEmail.ts";
import { base64Url, buildOutreachMime } from "./outreachMime.ts";
import { normalizeEmail, outreachStatusOf, planOutreach, repeatCutoff, utcDayStart, type PlanLead } from "./outreachPlan.ts";
import { OutreachNotSetUpError, type OutreachStore } from "./outreachStore.ts";
import { signToken } from "../notifications/tokens.ts";

/**
 * Orchestrates plan + send behind ports, so the routes stay thin and every rule is testable with fakes
 * (no Gmail, no database). The send path always re-plans from the stored facts; nothing the client says about
 * what is allowed is trusted.
 */

export type OutreachLeadRow = PlanLead & { name?: string | null; company?: string | null; title?: string | null };

export type OutreachDeps = {
  store: OutreachStore;
  userId: string;
  projectId: string | null;
  now: () => Date;
  loadLeads(ids: string[]): Promise<OutreachLeadRow[]>;
  /** The connected Gmail address: sender of real mail and the only recipient of a test send. */
  sender: { email: string; name?: string | null; company?: string | null };
  /** NOTIFY_SIGNING_SECRET and the public app URL; real sends need both. */
  signingSecret: string | null;
  appUrl: string | null;
  /** Posts a base64url raw RFC 5322 message through Gmail. */
  sendRaw(rawBase64Url: string): Promise<{ threadId: string; messageId: string }>;
  markLead(update: { leadId: string; status: "sent" | "failed"; sentAt: Date; threadId?: string; messageId?: string }): Promise<void>;
  /** Records `credits` credits for sent mail; resolves to how many were actually recorded. Must not throw (billing never blocks). */
  recordCredits(credits: number): Promise<number>;
  /** Optional pre-check; false means billing is on and the balance cannot cover `credits`. */
  canAfford?(credits: number): Promise<boolean>;
  log?(message: string): void;
};

export type OutreachHttpResult<T> = { status: number; body: T | { error: string } };

export const NOT_SET_UP_MESSAGE = "Outreach safeguards are not set up yet";
export const NEEDS_CONFIG_MESSAGE =
  "Sending needs NOTIFY_SIGNING_SECRET (at least 16 characters) and NEXT_PUBLIC_APP_URL to be set, so every email can carry a working unsubscribe link.";
const UNSUBSCRIBE_TTL_SECONDS = 3 * 365 * 24 * 3600;
const SEND_CONCURRENCY = 3;

export function unsubscribeUrlFor(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
}

export async function outreachStatus(deps: Pick<OutreachDeps, "store" | "userId" | "now">): Promise<OutreachStatus> {
  return outreachStatusOf(await deps.store.countSince(deps.userId, utcDayStart(deps.now())));
}

export async function computePlan(
  deps: Pick<OutreachDeps, "store" | "userId" | "now" | "loadLeads">,
  leadIds: string[],
  acceptGuessed: boolean,
): Promise<{ plan: OutreachPlanResponse; leads: OutreachLeadRow[] }> {
  const now = deps.now();
  const leads = leadIds.length ? await deps.loadLeads(leadIds) : [];
  const emails = [...new Set(leads.map((l) => normalizeEmail(l.email)).filter((e): e is string => !!e))];
  const [optedOut, lastSent, sentToday] = await Promise.all([
    deps.store.optedOut(deps.userId, emails),
    deps.store.lastSends(deps.userId, emails, repeatCutoff(now)),
    deps.store.countSince(deps.userId, utcDayStart(now)),
  ]);
  const plan = planOutreach({ leadIds, leads, acceptGuessed, optedOut, lastSent, sentToday, now });
  return { plan, leads };
}

export async function handlePlan(
  deps: Pick<OutreachDeps, "store" | "userId" | "now" | "loadLeads">,
  body: { leadIds?: unknown; acceptGuessed?: unknown },
): Promise<OutreachHttpResult<OutreachPlanResponse>> {
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  try {
    const { plan } = await computePlan(deps, leadIds, body.acceptGuessed === true);
    return { status: 200, body: plan };
  } catch (err) {
    if (err instanceof OutreachNotSetUpError) return { status: 503, body: { error: NOT_SET_UP_MESSAGE } };
    throw err;
  }
}

export async function handleStatus(deps: Pick<OutreachDeps, "store" | "userId" | "now">): Promise<OutreachHttpResult<OutreachStatus>> {
  try {
    return { status: 200, body: await outreachStatus(deps) };
  } catch (err) {
    if (err instanceof OutreachNotSetUpError) return { status: 503, body: { error: NOT_SET_UP_MESSAGE } };
    throw err;
  }
}

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/[\r\n]+/g, " ").slice(0, 300);
}

/** Validates the raw JSON body into an OutreachSendRequest, or returns the reason it is unusable. */
export function parseSendRequest(raw: unknown): { ok: true; req: OutreachSendRequest } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const leadIds = Array.isArray(b.leadIds) ? b.leadIds.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  const subject = typeof b.subject === "string" ? b.subject : "";
  const body = typeof b.body === "string" ? b.body : "";
  const test = b.test === true;
  if (!test && leadIds.length === 0) return { ok: false, error: "No leads selected." };
  if (!subject.trim() || !body.trim()) return { ok: false, error: "Subject and body are required." };
  if (subject.length > 300 || body.length > 20000) return { ok: false, error: "Subject or body is too long." };
  const templateId = isOutreachTemplateId(b.templateId) ? b.templateId : "plain";
  return { ok: true, req: { leadIds, subject, body, templateId, acceptGuessed: b.acceptGuessed === true, test } };
}

export async function handleSend(deps: OutreachDeps, req: OutreachSendRequest): Promise<OutreachHttpResult<OutreachSendResult>> {
  if (req.test) return handleTestSend(deps, req);

  // Fail closed: no signing secret or app URL means no unsubscribe link can be made, so nothing is sent.
  if (!deps.appUrl || !signToken({ userId: deps.userId, scope: "lead-unsubscribe", email: "probe@example.com" }, deps.signingSecret)) {
    return { status: 422, body: { error: NEEDS_CONFIG_MESSAGE } };
  }

  let plan: OutreachPlanResponse;
  let leads: OutreachLeadRow[];
  try {
    ({ plan, leads } = await computePlan(deps, req.leadIds, req.acceptGuessed === true));
  } catch (err) {
    if (err instanceof OutreachNotSetUpError) return { status: 503, body: { error: NOT_SET_UP_MESSAGE } };
    throw err;
  }

  if (deps.canAfford && plan.sendable.length > 0 && !(await deps.canAfford(plan.creditCost))) {
    return { status: 402, body: { error: "Not enough credits to send these emails." } };
  }

  const byId = new Map(leads.map((l) => [l.id, l]));
  const outcomes = new Map<string, OutreachSendResult["results"][number]>();
  const appUrl = deps.appUrl;

  const sendOne = async (leadId: string) => {
    const lead = byId.get(leadId)!;
    const email = normalizeEmail(lead.email)!;
    try {
      const token = signToken(
        { userId: deps.userId, scope: "lead-unsubscribe", email, leadId, ttlSeconds: UNSUBSCRIBE_TTL_SECONDS },
        deps.signingSecret,
      );
      if (!token) throw new Error("Could not create an unsubscribe link.");
      const rendered = renderOutreachEmail({
        templateId: req.templateId,
        subject: req.subject,
        body: req.body,
        lead,
        sender: { name: deps.sender.name, email: deps.sender.email, company: deps.sender.company },
        unsubscribeUrl: unsubscribeUrlFor(appUrl, token),
      });
      const raw = buildOutreachMime({
        fromEmail: deps.sender.email,
        fromName: deps.sender.name,
        toEmail: email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        headers: rendered.headers,
      });
      const { threadId, messageId } = await deps.sendRaw(base64Url(raw));
      const sentAt = deps.now();
      // The log write is what enforces cap and repeat rules; if it fails the mail is out, so report it as sent.
      await deps.store
        .recordSend({ userId: deps.userId, projectId: deps.projectId, leadId, email, sentAt, messageId: messageId ?? null })
        .catch((e) => deps.log?.(`outreach send log failed: ${errorText(e)}`));
      await deps.markLead({ leadId, status: "sent", sentAt, threadId, messageId }).catch((e) => deps.log?.(`lead update failed: ${errorText(e)}`));
      outcomes.set(leadId, { id: leadId, status: "sent", threadId, messageId });
    } catch (err) {
      await deps.markLead({ leadId, status: "failed", sentAt: deps.now() }).catch(() => {});
      outcomes.set(leadId, { id: leadId, status: "failed", error: errorText(err) });
    }
  };

  for (let i = 0; i < plan.sendable.length; i += SEND_CONCURRENCY) {
    await Promise.all(plan.sendable.slice(i, i + SEND_CONCURRENCY).map(sendOne));
  }

  const reasons = new Map<string, OutreachBlockReason>(plan.blocked.map((b) => [b.leadId, b.reason]));
  const results: OutreachSendResult["results"] = [];
  for (const id of new Set(req.leadIds)) {
    const done = outcomes.get(id);
    if (done) results.push(done);
    else results.push({ id, status: "skipped", reason: reasons.get(id) ?? "no_email" });
  }

  const sentCount = results.filter((r) => r.status === "sent").length;
  const credits = outreachCreditCost(sentCount);
  const creditsRecorded = credits > 0 ? await deps.recordCredits(credits) : 0;
  const status = outreachStatusOf(plan.status.sentToday + sentCount);
  return { status: 200, body: { results, status, creditsRecorded } };
}

async function handleTestSend(deps: OutreachDeps, req: OutreachSendRequest): Promise<OutreachHttpResult<OutreachSendResult>> {
  const first = req.leadIds.length ? (await deps.loadLeads(req.leadIds.slice(0, 1)))[0] : undefined;
  const lead = first ?? { id: "test", email: null, name: "Alex", company: "Example Co", title: "Founder" };
  let statusNow: OutreachStatus;
  try {
    statusNow = await outreachStatus(deps);
  } catch (err) {
    if (!(err instanceof OutreachNotSetUpError)) throw err;
    statusNow = outreachStatusOf(0);
  }
  try {
    const rendered = renderOutreachEmail({
      templateId: req.templateId,
      subject: req.subject,
      body: req.body,
      lead,
      sender: { name: deps.sender.name, email: deps.sender.email, company: deps.sender.company },
      unsubscribeUrl: null,
    });
    const raw = buildOutreachMime({
      fromEmail: deps.sender.email,
      fromName: deps.sender.name,
      toEmail: deps.sender.email,
      subject: `[Test] ${rendered.subject}`,
      text: rendered.text,
      html: rendered.html,
      headers: {},
    });
    const { threadId, messageId } = await deps.sendRaw(base64Url(raw));
    return { status: 200, body: { results: [{ id: "test", status: "sent", threadId, messageId }], status: statusNow, creditsRecorded: 0 } };
  } catch (err) {
    return { status: 200, body: { results: [{ id: "test", status: "failed", error: errorText(err) }], status: statusNow, creditsRecorded: 0 } };
  }
}
