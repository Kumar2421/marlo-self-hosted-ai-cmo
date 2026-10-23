import { getValidGmailAccessToken } from "@/lib/domain/shared/gmailOAuth";
import { plainTextFromGmailPayload } from "./replyStop";

export type GmailReply = { snippet: string; from: string; internalDate: string; /** Plain-text body, used only to spot "stop" requests. */ text?: string };

function getHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/**
 * Real inbox read — GET the full thread Gmail assigned our sent message to,
 * return any message after our own (a real reply, not a guess). No push/
 * webhook — this is called on-demand from an explicit "Check replies"
 * action, since there's no background worker in this app to poll on a
 * schedule. Needs gmail.readonly — a 403 here means the connected account
 * only has the older send-only grant and needs to reconnect.
 */
export async function listReplies(threadId: string, ourMessageId: string): Promise<GmailReply[]> {
  const accessToken = await getValidGmailAccessToken();

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Gmail rejected this — reconnect Gmail in Settings → API Credentials to enable reply tracking.");
    }
    const detail = await res.text().catch(() => "");
    throw new Error(`Gmail thread read failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();
  const messages: { id: string; snippet: string; payload?: { headers?: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: unknown[] } }[] = data.messages ?? [];

  return messages
    .filter((m) => m.id !== ourMessageId)
    .map((m) => ({
      snippet: m.snippet ?? "",
      from: getHeader(m.payload?.headers ?? [], "From"),
      internalDate: getHeader(m.payload?.headers ?? [], "Date"),
      text: plainTextFromGmailPayload(m.payload as Parameters<typeof plainTextFromGmailPayload>[0]),
    }));
}
