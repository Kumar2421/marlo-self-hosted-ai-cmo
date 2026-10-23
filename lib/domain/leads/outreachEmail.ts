import { mergeOutreachTags, type OutreachTemplateId } from "./outreachContract.ts";

/**
 * Builds the outreach email (subject, HTML, plain text, headers) from a fixed template. Used by the server when
 * sending and by the compose preview, so what the user previews is exactly what is sent. Pure.
 *
 * The user only ever supplies plain text (subject and body). Templates are code, and every user-supplied value is
 * HTML-escaped, so a template can never carry markup or scripts from the user or from a lead's fields.
 */

export type OutreachSender = {
  /** Shown as the sign-off / card header. Falls back to the email address. */
  name?: string | null;
  email: string;
  company?: string | null;
  /** Postal address line for the footer (commercial email rules ask for one). Optional. */
  address?: string | null;
};

export type OutreachLeadFields = { name?: string | null; company?: string | null; title?: string | null };

export type OutreachEmailInput = {
  templateId: OutreachTemplateId;
  subject: string;
  body: string;
  lead: OutreachLeadFields;
  sender: OutreachSender;
  /** The one-click unsubscribe address for this lead. Null in a preview with no real lead: the footer link is a placeholder. */
  unsubscribeUrl: string | null;
};

export type RenderedOutreachEmail = {
  subject: string;
  html: string;
  text: string;
  /** Extra headers to send (List-Unsubscribe pair when there is a real unsubscribe address). */
  headers: Record<string, string>;
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TEXT = "#1c1917";
const MUTED = "#78716c";
const BORDER = "#e7e5e4";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only http(s) links are ever placed in an href. */
export function safeHref(url: string | null): string {
  if (!url) return "#";
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "#";
  } catch {
    return "#";
  }
}

/** Blank lines separate paragraphs; single newlines stay as line breaks. */
export function bodyToParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function paragraphsHtml(paragraphs: string[]): string {
  return paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${TEXT}">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function signOff(sender: OutreachSender): string {
  const lines = [sender.name?.trim() || sender.email, sender.company?.trim() || ""].filter(Boolean);
  return lines.join("\n");
}

function footerText(sender: OutreachSender, unsubscribeUrl: string | null): string {
  const parts = [
    `You are receiving this because ${sender.name?.trim() || sender.email} thought it could be relevant to you.`,
    `Unsubscribe: ${unsubscribeUrl ?? "(link appears here)"}`,
  ];
  if (sender.address?.trim()) parts.push(sender.address.trim());
  return parts.join("\n");
}

function footerHtml(sender: OutreachSender, unsubscribeUrl: string | null): string {
  const who = escapeHtml(sender.name?.trim() || sender.email);
  const address = sender.address?.trim() ? `<br>${escapeHtml(sender.address.trim())}` : "";
  return (
    `<div style="margin-top:28px;padding-top:14px;border-top:1px solid ${BORDER};font-size:12px;line-height:1.5;color:${MUTED}">` +
    `You are receiving this because ${who} thought it could be relevant to you. ` +
    `<a href="${escapeHtml(safeHref(unsubscribeUrl))}" style="color:${MUTED};text-decoration:underline">Unsubscribe</a>${address}</div>`
  );
}

function wrap(templateId: OutreachTemplateId, inner: string, sender: OutreachSender, footer: string): string {
  const shell = (content: string) =>
    `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff"><div style="font-family:${FONT};color:${TEXT}">${content}</div></body></html>`;
  if (templateId === "plain") {
    return shell(`<div style="max-width:560px;padding:8px 4px">${inner}${footer}</div>`);
  }
  const sig = escapeHtml(signOff(sender)).replace(/\n/g, "<br>");
  const signature = `<p style="margin:18px 0 0;font-size:15px;line-height:1.5;color:${TEXT}">${sig}</p>`;
  if (templateId === "clean") {
    return shell(
      `<div style="max-width:560px;padding:24px 20px"><div style="height:3px;width:40px;background:#ea580c;margin-bottom:22px"></div>${inner}${signature}${footer}</div>`,
    );
  }
  const company = sender.company?.trim() ? `<div style="font-size:12px;color:${MUTED};margin-top:2px">${escapeHtml(sender.company.trim())}</div>` : "";
  return shell(
    `<div style="max-width:600px;padding:20px 12px"><div style="border:1px solid ${BORDER};border-radius:12px;overflow:hidden">` +
      `<div style="padding:16px 22px;background:#fafaf9;border-bottom:1px solid ${BORDER}"><div style="font-size:14px;font-weight:600;color:${TEXT}">${escapeHtml(sender.name?.trim() || sender.email)}</div>${company}</div>` +
      `<div style="padding:22px">${inner}${signature}</div></div>${footer}</div>`,
  );
}

export function renderOutreachEmail(input: OutreachEmailInput): RenderedOutreachEmail {
  const subject = mergeOutreachTags(input.subject, input.lead).replace(/[\r\n]+/g, " ").trim();
  const body = mergeOutreachTags(input.body, input.lead);
  const paragraphs = bodyToParagraphs(body);
  const html = wrap(input.templateId, paragraphsHtml(paragraphs), input.sender, footerHtml(input.sender, input.unsubscribeUrl));
  const sign = input.templateId === "plain" ? "" : `\n\n${signOff(input.sender)}`;
  const text = `${paragraphs.join("\n\n")}${sign}\n\n--\n${footerText(input.sender, input.unsubscribeUrl)}\n`;
  const headers: Record<string, string> = {};
  if (input.unsubscribeUrl && safeHref(input.unsubscribeUrl) !== "#") {
    headers["List-Unsubscribe"] = `<${safeHref(input.unsubscribeUrl)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return { subject, html, text, headers };
}
