import { getValidGmailAccessToken } from "@/lib/domain/shared/gmailOAuth";

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Real Gmail send — RFC 2822 message, base64url-encoded, POSTed to Gmail's
 * real send endpoint. No mock mode: this genuinely sends an email to a real
 * inbox, so callers must only invoke it from an explicit user action.
 * Returns the real threadId + messageId Gmail assigned — callers store both
 * per-lead so gmailInbox.ts's listReplies() knows which thread to poll and
 * which message in it is ours (not a "reply"). */
export async function sendGmail(to: string, fromEmail: string, subject: string, body: string): Promise<{ threadId: string; messageId: string }> {
  const accessToken = await getValidGmailAccessToken();

  const message = [`From: ${fromEmail}`, `To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
    "\r\n"
  );

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64UrlEncode(message) }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gmail send failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();
  return { threadId: data.threadId, messageId: data.id };
}

/** POSTs an already-built message (base64url RFC 5322) to Gmail's send endpoint. Used by outreach, which builds its own MIME. */
export async function postGmailRaw(accessToken: string, rawBase64Url: string): Promise<{ threadId: string; messageId: string }> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: rawBase64Url }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gmail send failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  return { threadId: data.threadId, messageId: data.id };
}

/** Self-host variant of postGmailRaw: resolves the stored OAuth token first. */
export async function sendGmailRaw(rawBase64Url: string): Promise<{ threadId: string; messageId: string }> {
  return postGmailRaw(await getValidGmailAccessToken(), rawBase64Url);
}
