import { OUTCOME_CAVEAT, type Digest, type DigestProject, type MeasuredFix } from "./digest.ts";
import type { NotificationKind } from "./types.ts";

/** Title of the in-app item for social drafts; singular and plural aware. */
export function socialDraftsTitle(total: number): string {
  return total === 1 ? "1 new social draft is ready" : `${total} new social drafts are ready`;
}

const NETWORK_NAMES: Record<string, string> = { x: "X", linkedin: "LinkedIn", reddit: "Reddit" };

/** Body for the social drafts item: names the networks that got a draft, in a fixed order. */
export function socialDraftsBody(networks: string[]): string {
  const names = ["x", "linkedin", "reddit"].filter((n) => networks.includes(n)).map((n) => NETWORK_NAMES[n]);
  const list = names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return list
    ? `Drafts for ${list} are waiting in the Social tab. Nothing is posted until you post it yourself.`
    : "Drafts are waiting in the Social tab. Nothing is posted until you post it yourself.";
}

export type EmailLinks = {
  /** Where the primary button goes (the dashboard). */
  openUrl: string;
  /** One-click unsubscribe from all Marlo emails, token-signed. */
  unsubscribeUrl: string;
  /** Login-required settings page. */
  preferencesUrl: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
  /** Includes List-Unsubscribe and List-Unsubscribe-Post (RFC 8058). */
  headers: Record<string, string>;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) links are ever put in an href. */
function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

/** Marlo's own emails are all optional, so every one carries the one-click unsubscribe headers. */
export function unsubscribeHeaders(links: Pick<EmailLinks, "unsubscribeUrl">): Record<string, string> {
  return {
    "List-Unsubscribe": `<${links.unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

type Section = { heading: string; items: string[]; note?: string };
type Layout = { subject: string; preheader: string; title: string; intro?: string; sections: Section[]; cta: { label: string; url: string } };

const INK = "#111827";
const MUTED = "#4b5563";

function layoutEmail(layout: Layout, links: EmailLinks): RenderedEmail {
  const footerText = `You get this because you use Marlo. Unsubscribe from all Marlo emails: ${links.unsubscribeUrl}\nChange what you receive: ${links.preferencesUrl}`;

  const text = [
    layout.title,
    "",
    ...(layout.intro ? [layout.intro, ""] : []),
    ...layout.sections.flatMap((s) => [s.heading.toUpperCase(), ...s.items.map((i) => `- ${i}`), ...(s.note ? [s.note] : []), ""]),
    `${layout.cta.label}: ${layout.cta.url}`,
    "",
    "--",
    footerText,
  ].join("\n");

  const sections = layout.sections
    .map(
      (s) =>
        `<h2 style="font-size:15px;margin:24px 0 8px;color:${INK}">${escapeHtml(s.heading)}</h2>` +
        `<ul style="margin:0;padding-left:20px;color:${INK};font-size:14px;line-height:1.6">${s.items.map((i) => `<li style="margin-bottom:6px">${escapeHtml(i)}</li>`).join("")}</ul>` +
        (s.note ? `<p style="margin:8px 0 0;font-size:12px;color:${MUTED}">${escapeHtml(s.note)}</p>` : ""),
    )
    .join("");

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(layout.title)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">` +
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(layout.preheader)}</div>` +
    `<main style="max-width:560px;margin:0 auto">` +
    `<h1 style="font-size:20px;margin:0 0 12px;color:${INK}">${escapeHtml(layout.title)}</h1>` +
    (layout.intro ? `<p style="margin:0;font-size:14px;line-height:1.6;color:${INK}">${escapeHtml(layout.intro)}</p>` : "") +
    sections +
    `<p style="margin:28px 0 0"><a href="${escapeHtml(safeUrl(layout.cta.url))}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:underline;padding:10px 18px;border-radius:8px;font-size:14px">${escapeHtml(layout.cta.label)}</a></p>` +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px">` +
    `<p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED}">You get this because you use Marlo. ` +
    `<a href="${escapeHtml(safeUrl(links.unsubscribeUrl))}" style="color:${MUTED}">Unsubscribe from all Marlo emails</a> or ` +
    `<a href="${escapeHtml(safeUrl(links.preferencesUrl))}" style="color:${MUTED}">change what you receive</a>.</p>` +
    `</main></body></html>`;

  return { subject: layout.subject, html, text, headers: unsubscribeHeaders(links) };
}

const VERDICT: Record<MeasuredFix["status"], string> = {
  improved: "Looks better",
  unchanged: "No clear change",
  regressed: "Looks worse",
};

function outcomeLine(o: MeasuredFix): string {
  return `${o.actionTitle}: ${VERDICT[o.status]}. ${o.headline}`;
}

function movementLine(p: DigestProject): string | null {
  const m = p.movement;
  if (!m) return null;
  const parts = [
    `clicks ${m.clicks.before} to ${m.clicks.after}`,
    `views ${m.impressions.before} to ${m.impressions.after}`,
  ];
  if (m.position) parts.push(`average position ${m.position.before.toFixed(1)} to ${m.position.after.toFixed(1)}`);
  return `Compared with the week before: ${parts.join(", ")}.`;
}

export function renderDigestEmail(digest: Digest, links: EmailLinks, cadence: "weekly" | "daily" = "weekly"): RenderedEmail {
  const period = cadence === "daily" ? "day" : "week";
  const multi = digest.projects.length > 1;
  const sections: Section[] = [];
  for (const p of digest.projects) {
    const prefix = multi ? `${p.projectName}: ` : "";
    if (p.outcomes.length) {
      sections.push({ heading: `${prefix}Fixes we measured`, items: p.outcomes.map(outcomeLine), note: OUTCOME_CAVEAT });
    }
    if (p.fixesMade.length) sections.push({ heading: `${prefix}Changes you made`, items: p.fixesMade });
    const movement = movementLine(p);
    if (movement) sections.push({ heading: `${prefix}Search movement`, items: [movement] });
    if (p.approvalsWaiting > 0) {
      sections.push({ heading: `${prefix}Waiting for you`, items: [`${p.approvalsWaiting} ${p.approvalsWaiting === 1 ? "fix is" : "fixes are"} waiting for your review.`] });
    }
  }
  return layoutEmail(
    {
      subject: `Your Marlo ${period}: ${digest.summary.replace(/\.$/, "")}`,
      preheader: digest.summary,
      title: `Your ${period} in Marlo`,
      intro: digest.summary,
      sections,
      cta: { label: "Open Marlo", url: links.openUrl },
    },
    links,
  );
}

/** A single notification (big win, credits, approvals, integration) as its own email. */
export function renderNotificationEmail(
  n: { kind: NotificationKind; title: string; body: string },
  links: EmailLinks,
): RenderedEmail {
  const caveat = n.kind === "outcome_measured" ? OUTCOME_CAVEAT : undefined;
  return layoutEmail(
    {
      subject: n.title,
      preheader: n.body,
      title: n.title,
      intro: n.body,
      sections: caveat ? [{ heading: "A note on this result", items: [caveat] }] : [],
      cta: { label: n.kind === "credits_low" ? "See your credits" : "Open Marlo", url: links.openUrl },
    },
    links,
  );
}

export function renderTestEmail(links: EmailLinks): RenderedEmail {
  return layoutEmail(
    {
      subject: "Marlo test email",
      preheader: "Email notifications are set up.",
      title: "This is a test email from Marlo",
      intro: "If you can read this, Marlo can email you. You will only get the notifications you leave switched on.",
      sections: [],
      cta: { label: "Open Marlo", url: links.openUrl },
    },
    links,
  );
}
