import OpenAI from "openai";
import type { LlmDriver, ToolDef } from "./types";

const MAX_TOOL_ROUNDS = 4;

/** Runs the tool-call loop: ask the model, execute any tool calls it makes,
 * feed results back, repeat — until it answers with plain text or we hit
 * MAX_TOOL_ROUNDS (at which point we force a final answer with tools
 * disabled, so a model stuck searching still produces a document). Only
 * intermediate rounds are non-streaming — the caller streams the final round
 * normally, so real research doesn't cost the live "model is writing" UX. */
async function runToolLoop(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: ToolDef[],
  requestOptions: OpenAI.RequestOptions
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const toolSpecs: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const byName = new Map(tools.map((t) => [t.name, t]));
  const working = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat.completions.create(
      {
        model,
        messages: working,
        tools: toolSpecs,
        tool_choice: "auto",
      },
      requestOptions,
    );
    const choice = response.choices[0]?.message;
    if (!choice) break;

    working.push(choice);
    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      // Model answered directly — nothing left to resolve.
      return working;
    }

    for (const call of choice.tool_calls) {
      if (call.type !== "function") {
        working.push({ role: "tool", tool_call_id: call.id, content: "Unsupported tool call type" });
        continue;
      }
      const tool = byName.get(call.function.name);
      let result: string;
      if (!tool) {
        result = `Unknown tool: ${call.function.name}`;
      } else {
        try {
          const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          result = await tool.execute(args);
        } catch (e) {
          result = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      working.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  return working;
}

const openaiDriver: LlmDriver = async ({ apiKey, model, messages, system, stream, baseUrl, tools, timeoutMs, maxRetries, signal }) => {
  // Local servers (LM Studio, Ollama) usually don't check the key at all —
  // the OpenAI SDK still requires a non-empty string to construct, so pass a
  // placeholder rather than failing before the request even goes out.
  // timeoutMs and maxRetries are set only by background jobs; routes keep the SDK defaults.
  const client = new OpenAI({
    apiKey: apiKey || "not-required",
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
    ...(maxRetries !== undefined ? { maxRetries } : {}),
  });
  const requestOptions: OpenAI.RequestOptions = signal ? { signal } : {};

  const finalMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) {
    finalMessages.push({ role: "system", content: system });
  }
  finalMessages.push(...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));

  let resolvedMessages = finalMessages;
  if (tools && tools.length > 0) {
    resolvedMessages = await runToolLoop(client, model, finalMessages, tools, requestOptions);
    const last = resolvedMessages[resolvedMessages.length - 1];

    // The loop already ended with the model's real final answer (no more
    // tool calls) — that text already exists, so don't ask again (the model
    // would just respond to its own prior turn). Return it as-is, faked into
    // a single-chunk stream if the caller wanted one.
    if (last?.role === "assistant" && typeof last.content === "string") {
      const text = last.content;
      if (stream) {
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(text));
            controller.close();
          },
        });
        return { stream: readable };
      }
      return { text };
    }
    // Otherwise the loop hit MAX_TOOL_ROUNDS still mid tool-call — fall
    // through to one more, tool-free call below so the model is forced to
    // write its actual answer instead of researching forever.
  }

  const forceNoTools = tools && tools.length > 0;
  const finalToolArgs = forceNoTools ? { tool_choice: "none" as const } : {};

  if (stream) {
    const responseStream = await client.chat.completions.create(
      {
        model,
        messages: resolvedMessages,
        stream: true,
        ...finalToolArgs,
      },
      requestOptions,
    );

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            const text = chunk.choices[0]?.delta?.content;
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });
    return { stream: readable };
  }

  const response = await client.chat.completions.create(
    {
      model,
      messages: resolvedMessages,
      ...finalToolArgs,
    },
    requestOptions,
  );

  const text = response.choices[0]?.message?.content ?? "";
  return { text };
};

export default openaiDriver;
