/**
 * Pure Server-Sent Events encoder/decoder for the chat stream. No I/O, no React,
 * so node tests cover chunk boundaries, malformed input and unicode.
 *
 * Wire format, one event per frame: `event: <type>\ndata: <json>\n\n`.
 * The JSON always carries `type` too, so a reader may ignore the `event:` line.
 */
export type StreamEvent =
  | { type: "status"; phase: "thinking" | "tool"; label: string; tool?: string }
  | { type: "delta"; text: string }
  | { type: "done"; toolsUsed: string[]; lookedAt: string[]; threadId?: string }
  | { type: "error"; message: string; code?: string } & ChatLimitFields;

/** Same fields the JSON endpoint puts in a 402 chat_limit body, so one client path handles both. */
export type ChatLimitFields = { used?: number; limit?: number; resetsAt?: string | null; plan?: string };

/** A comment frame. Keeps proxies and load balancers from closing an idle connection. */
export const SSE_KEEPALIVE = ": keepalive\n\n";

export function encodeSseEvent(ev: StreamEvent): string {
  return `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Validates one decoded JSON value. Unknown or malformed shapes return null (the frame is skipped). */
export function parseStreamEvent(raw: unknown): StreamEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  switch (o.type) {
    case "status":
      if ((o.phase !== "thinking" && o.phase !== "tool") || typeof o.label !== "string") return null;
      return { type: "status", phase: o.phase, label: o.label, ...(typeof o.tool === "string" ? { tool: o.tool } : {}) };
    case "delta":
      return typeof o.text === "string" ? { type: "delta", text: o.text } : null;
    case "done":
      return { type: "done", toolsUsed: strings(o.toolsUsed), lookedAt: strings(o.lookedAt), ...(typeof o.threadId === "string" ? { threadId: o.threadId } : {}) };
    case "error":
      if (typeof o.message !== "string") return null;
      return {
        type: "error", message: o.message,
        ...(typeof o.code === "string" ? { code: o.code } : {}),
        ...(typeof o.used === "number" ? { used: o.used } : {}),
        ...(typeof o.limit === "number" ? { limit: o.limit } : {}),
        ...(typeof o.resetsAt === "string" || o.resetsAt === null ? { resetsAt: o.resetsAt as string | null } : {}),
        ...(typeof o.plan === "string" ? { plan: o.plan } : {}),
      };
    default:
      return null;
  }
}

export type SseDecoder = {
  /** Feed the next chunk (bytes or text). Returns every event completed by it; partial frames are held back. */
  push(chunk: string | Uint8Array): StreamEvent[];
  /** Flush at end of stream: a final frame missing its blank line still counts if it is complete. */
  end(): StreamEvent[];
};

export function createSseDecoder(): SseDecoder {
  const bytes = new TextDecoder("utf-8");
  let buffer = "";

  function frameToEvent(frame: string): StreamEvent | null {
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line === "" || line.startsWith(":")) continue; // blank or comment
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      if (field !== "data") continue;
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      data.push(value);
    }
    if (data.length === 0) return null;
    try {
      return parseStreamEvent(JSON.parse(data.join("\n")));
    } catch {
      return null; // malformed JSON: skip the frame, keep the stream alive
    }
  }

  function drain(final: boolean): StreamEvent[] {
    // Normalise CRLF and lone CR so frames always split on a blank line.
    // A trailing CR may be half of a CRLF split across chunks, so keep it buffered.
    let text = buffer;
    let tail = "";
    if (!final && text.endsWith("\r")) { tail = "\r"; text = text.slice(0, -1); }
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const out: StreamEvent[] = [];
    let idx: number;
    while ((idx = text.indexOf("\n\n")) !== -1) {
      const ev = frameToEvent(text.slice(0, idx));
      if (ev) out.push(ev);
      text = text.slice(idx + 2);
    }
    if (final) {
      const ev = frameToEvent(text);
      if (ev) out.push(ev);
      text = "";
    }
    buffer = text + tail;
    return out;
  }

  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : bytes.decode(chunk, { stream: true });
      return drain(false);
    },
    end() {
      buffer += bytes.decode();
      return drain(true);
    },
  };
}
