export type ChatMessage = { role: "user" | "assistant"; content: string };

/** A tool the model can call mid-generation to do real research before writing
 * — e.g. web search. `parameters` is a JSON Schema object describing the
 * arguments, exactly as sent to the provider. `execute` runs server-side only
 * and is never sent to the provider — only its name/description/schema are;
 * its return value is fed back to the model as the tool result. */
export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<string>;
};

export type CompletionRequest = {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  system?: string;
  stream?: boolean;
  /** Overrides the provider SDK's default API host — used for local/self-hosted
   * OpenAI-compatible servers (LM Studio, Ollama, custom endpoints). */
  baseUrl?: string;
  /** When set, the driver runs a tool-call loop (model calls a tool, driver
   * executes it, feeds the result back, repeats) before producing the final
   * answer. Only implemented in the OpenAI-compatible driver so far — other
   * drivers ignore this and behave as before. */
  tools?: ToolDef[];
  /** Per-request timeout in ms for the provider call. Unset keeps the SDK default. Used by background jobs. */
  timeoutMs?: number;
  /** SDK retries for this call. Unset keeps the SDK default (2). Background jobs pass 0. */
  maxRetries?: number;
  /** Aborts the in-flight provider request when it fires. */
  signal?: AbortSignal;
};

export type CompletionResult = { 
  text?: string;
  stream?: ReadableStream<Uint8Array>;
};

export type LlmDriver = (req: CompletionRequest) => Promise<CompletionResult>;
