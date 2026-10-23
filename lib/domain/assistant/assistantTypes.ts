/** Shared vocabulary of the assistant service. Pure types plus AssistantError. */

export type ChatTurnMessage = { role: "user" | "assistant"; content: string };

/**
 * Raw per-turn input as received from the client. Fields are `unknown` where
 * the service itself validates them (message/history/projectId).
 */
export type AssistantTurnInput = {
  message: unknown;
  history: unknown;
  projectId: unknown;
  // The client no longer picks provider/model: the server decides (modelSelection.ts). Legacy
  // `providerId`/`model` body fields are never read by the route, so they cannot steer which key is used.
};

/** Successful turn: the JSON body the chat API returns. */
export type AssistantTurnResult = { reply: string | undefined; toolsUsed: string[]; lookedAt: string[] };

/** Who is asking and where. userId / activeProjectId are filled in by the service as it learns them. */
export type TurnContext = {
  mode: "platform" | "selfhost";
  userId: string | null;
  activeProjectId: string | null;
};

/** Every expected failure of a turn. `status` is the HTTP status, `userMessage` the exact `error` body. */
export class AssistantError extends Error {
  readonly status: number;
  readonly userMessage: string;
  /** Underlying provider/system error, if any. Never sent to the client. */
  readonly cause?: unknown;
  constructor(status: number, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = "AssistantError";
    this.status = status;
    this.userMessage = userMessage;
    this.cause = cause;
  }
}
