/** Typed Google auth failures. Messages are fixed text per code plus Google's own
 * short `error_description`; request bodies, tokens and client secrets are never
 * echoed. */
export type GoogleAuthErrorCode = "invalid_client" | "invalid_grant" | "insufficient_scope" | "network" | "unknown";

const MESSAGES: Record<GoogleAuthErrorCode, string> = {
  invalid_client: "Google rejected this app's OAuth client (client ID or secret does not match the one that issued the connection).",
  invalid_grant: "Google no longer accepts this connection (access was revoked or expired). Reconnect Google.",
  insufficient_scope: "Google did not grant the permission this needs. Reconnect Google and tick every permission.",
  network: "Could not reach Google. Try again in a moment.",
  unknown: "Google returned an unexpected error.",
};

export class GoogleAuthError extends Error {
  readonly code: GoogleAuthErrorCode;
  readonly status?: number;
  constructor(code: GoogleAuthErrorCode, detail?: string, status?: number) {
    super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code]);
    this.name = "GoogleAuthError";
    this.code = code;
    this.status = status;
  }
}

export function isGoogleAuthError(value: unknown): value is GoogleAuthError {
  return value instanceof GoogleAuthError;
}

/** Failures that mean the stored connection cannot recover without the user reconnecting. */
export function needsReconnect(code: GoogleAuthErrorCode): boolean {
  return code === "invalid_grant" || code === "invalid_client";
}

/** Env values pasted into a host dashboard often carry a trailing newline or space, which Google reports as invalid_client. */
export function envValue(raw: string | undefined | null): string {
  return (raw ?? "").trim();
}

function shortText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim().slice(0, 160);
  return text || undefined;
}

function parseJson(bodyText: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Token endpoint failure: Google answers `{ "error": "invalid_grant", "error_description": "..." }`. */
export function parseGoogleTokenError(status: number, bodyText: string): GoogleAuthError {
  const body = parseJson(bodyText);
  const error = typeof body?.error === "string" ? body.error : "";
  const detail = shortText(body?.error_description);
  if (error === "invalid_client" || error === "unauthorized_client") return new GoogleAuthError("invalid_client", detail, status);
  if (error === "invalid_grant") return new GoogleAuthError("invalid_grant", detail, status);
  if (error === "invalid_scope" || error === "access_denied" || error === "insufficient_scope") {
    return new GoogleAuthError("insufficient_scope", detail, status);
  }
  return new GoogleAuthError("unknown", `HTTP ${status}${error ? `, ${error.slice(0, 60)}` : ""}`, status);
}

/** Google API (Search Console / Analytics Admin) failure: `{ "error": { "code", "message", "status" } }`. */
export function parseGoogleApiError(status: number, bodyText: string): GoogleAuthError {
  const body = parseJson(bodyText);
  const err = body?.error && typeof body.error === "object" ? (body.error as Record<string, unknown>) : null;
  const detail = shortText(err?.message);
  if (status === 401) return new GoogleAuthError("invalid_grant", detail, status);
  if (status === 403) return new GoogleAuthError("insufficient_scope", detail, status);
  return new GoogleAuthError("unknown", detail ?? `HTTP ${status}`, status);
}
