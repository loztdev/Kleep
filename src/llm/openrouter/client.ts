/**
 * OpenRouterClient — provider-agnostic `LlmProvider` backed by OpenRouter's
 * OpenAI-compatible Chat Completions API.
 *
 * Mirrors `ClaudeClient`'s shape (retry+jitter, cost tracking, a Zod-backed
 * structured-output helper, streaming) but implements `LlmProvider`
 * directly rather than through an adapter — OpenRouter's wire message
 * shape (`{role, content}`) already matches `LlmMessage` with no
 * translation needed, unlike Claude's content-block array.
 *
 * No default model: OpenRouter's catalog changes over time and guessing a
 * model id that may since be retired is worse than failing loudly. Pass
 * `model` per call or `defaultModel` at construction.
 */

import type { z } from "zod";
import { CostTracker } from "../costTracker";
import type {
  LlmMessage,
  LlmProvider,
  LlmSendOptions,
  LlmStreamChunk,
  LlmStreamHandle,
  LlmStructuredOptions,
  LlmStructuredResult,
  LlmTextResult,
  LlmToolUse,
} from "../types";
import { zodToToolInputSchema } from "../zodToJsonSchema";
import { RealOpenRouterTransport, type RealOpenRouterTransportOptions } from "./realTransport";
import { type ResolvedRetryOptions, type RetryOptions, resolveRetryOptions, withRetry } from "./retry";
import {
  OpenRouterEmptyResponseError,
  type OpenRouterCacheControl,
  type OpenRouterMessage,
  type OpenRouterRequest,
  type OpenRouterRequestOptions,
  type OpenRouterResponse,
  type OpenRouterTool,
  type OpenRouterTransport,
} from "./types";

/** Construction options for `OpenRouterClient`. */
export interface OpenRouterClientOptions {
  /** OpenRouter API key. Required unless `transport` is supplied directly (e.g. a `FixtureTransport` in tests). */
  apiKey?: string;
  /** Override the API host — passed through to `RealOpenRouterTransport`. */
  baseURL?: string;
  httpReferer?: RealOpenRouterTransportOptions["httpReferer"];
  appTitle?: RealOpenRouterTransportOptions["appTitle"];
  /** Per-request timeout passed through to `RealOpenRouterTransport`. Default 60s. */
  timeoutMs?: RealOpenRouterTransportOptions["timeoutMs"];
  /** Pre-built transport — bypasses `apiKey`/`baseURL`. Used by tests and by callers wiring their own. */
  transport?: OpenRouterTransport;
  /** Model used when a call doesn't specify one. No default — see module doc. */
  defaultModel?: string;
  /** `max_tokens` used when a call doesn't specify one. Default 4096. */
  defaultMaxTokens?: number;
  /** Shared cost tracker. Defaults to a fresh `CostTracker`. */
  costTracker?: CostTracker;
  /** Retry/backoff tuning. */
  retry?: RetryOptions;
}

/** Thrown when OpenRouter doesn't return the requested tool call, or its arguments fail schema validation. */
export class StructuredOutputError extends Error {
  constructor(
    message: string,
    public readonly response: OpenRouterResponse,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/** OpenRouter-backed `LlmProvider`: retry, cost tracking, structured output, and streaming. */
export class OpenRouterClient implements LlmProvider {
  readonly name = "openrouter";
  readonly costTracker: CostTracker;
  private readonly transport: OpenRouterTransport;
  private readonly defaultModel?: string;
  private readonly defaultMaxTokens: number;
  private readonly retryOptions: ResolvedRetryOptions;

  constructor(opts: OpenRouterClientOptions) {
    if (opts.transport) {
      this.transport = opts.transport;
    } else {
      if (!opts.apiKey) {
        throw new Error("OpenRouterClient requires either `apiKey` or `transport`");
      }
      this.transport = new RealOpenRouterTransport({
        apiKey: opts.apiKey,
        ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
        ...(opts.httpReferer ? { httpReferer: opts.httpReferer } : {}),
        ...(opts.appTitle ? { appTitle: opts.appTitle } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      });
    }
    this.defaultModel = opts.defaultModel;
    this.defaultMaxTokens = opts.defaultMaxTokens ?? 4096;
    this.costTracker = opts.costTracker ?? new CostTracker();
    this.retryOptions = resolveRetryOptions(opts.retry);
  }

  totalCostUsd(): number {
    return this.costTracker.totalUsd();
  }

  async sendMessage(opts: LlmSendOptions): Promise<LlmTextResult> {
    const request = this.buildRequest(opts);
    const requestOptions = buildRequestOptions(opts);
    const response = await withRetry(() => this.transport.send(request, requestOptions), this.retryOptions);
    this.recordCost(response);
    return toTextResult(response);
  }

  async structured<T>(opts: LlmStructuredOptions<T>): Promise<LlmStructuredResult<T>> {
    const parameters = zodToToolInputSchema(opts.tool.schema as z.ZodTypeAny);
    const tool: OpenRouterTool = {
      type: "function",
      function: { name: opts.tool.name, description: opts.tool.description, parameters },
    };
    const request: OpenRouterRequest = {
      ...this.buildRequest(opts),
      tools: [tool],
      tool_choice: { type: "function", function: { name: opts.tool.name } },
    };
    const requestOptions = buildRequestOptions(opts);

    const response = await withRetry(() => this.transport.send(request, requestOptions), this.retryOptions);
    this.recordCost(response);

    const call = response.choices[0]?.message.tool_calls?.find((c) => c.function.name === opts.tool.name);
    if (!call) {
      throw new StructuredOutputError(`OpenRouter did not return a "${opts.tool.name}" tool call`, response);
    }

    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments);
    } catch (err) {
      throw new StructuredOutputError(
        `"${opts.tool.name}" tool call arguments were not valid JSON: ${(err as Error).message}`,
        response,
      );
    }
    const parsed = opts.tool.schema.safeParse(input);
    if (!parsed.success) {
      throw new StructuredOutputError(
        `"${opts.tool.name}" tool call failed schema validation: ${parsed.error.message}`,
        response,
      );
    }
    return { data: parsed.data };
  }

  streamMessage(opts: LlmSendOptions): LlmStreamHandle {
    const request = this.buildRequest(opts);
    const stream = this.transport.stream(request, buildRequestOptions(opts));

    async function* chunks(): AsyncGenerator<LlmStreamChunk, void, void> {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) yield { type: "text", text };
      }
    }

    const final = stream.finalMessage().then((response) => {
      this.recordCost(response);
      return toTextResult(response);
    });
    // A caller who only drains `chunks` (never awaiting `final`) shouldn't
    // crash the process on a stream error — see the equivalent guard in
    // ClaudeClient.streamMessage / RealOpenRouterTransport.stream.
    final.catch(() => undefined);

    return { chunks: chunks(), final };
  }

  private buildRequest(opts: LlmSendOptions): OpenRouterRequest {
    const model = opts.model ?? this.defaultModel;
    if (!model) {
      throw new Error("OpenRouterClient: no model specified — pass `model` per call or `defaultModel` at construction");
    }
    // OpenRouter has no single-field "automatic" cache_control the way Anthropic's
    // own API does — the breakpoint has to be placed on a specific content block.
    // Marking the system message (the static prefix) and the newest message (so
    // the boundary advances as the conversation grows) reproduces that same
    // "cache everything so far" effect with the block-level mechanism OpenRouter
    // actually supports. Models/providers that don't understand `cache_control`
    // just ignore the field.
    const cacheControl: OpenRouterCacheControl | undefined = opts.cache
      ? { type: "ephemeral", ...(opts.cacheTtl ? { ttl: opts.cacheTtl } : {}) }
      : undefined;

    // A user turn whose content is `tool_result` blocks becomes several
    // separate `role: "tool"` messages in the OpenAI-compat shape — one per
    // tool call — so `flatMap` rather than `map`.
    const conversationMessages = opts.messages.flatMap(toOpenRouterMessages);
    const lastIndex = conversationMessages.length - 1;
    if (cacheControl && lastIndex >= 0) {
      conversationMessages[lastIndex] = withCacheControl(conversationMessages[lastIndex]!, cacheControl);
    }

    const messages: OpenRouterMessage[] = [
      ...(opts.system !== undefined
        ? [withCacheControl({ role: "system" as const, content: opts.system }, cacheControl)]
        : []),
      ...conversationMessages,
    ];
    // `maxTokens === 0` is the "unlimited" sentinel — OpenRouter's API treats
    // an omitted `max_tokens` as "use whatever the underlying model's own
    // maximum is," which is exactly what users mean by unlimited. `undefined`
    // still falls back to `defaultMaxTokens` so existing internal callers
    // (extraction, summarization) that never set the field keep their
    // conservative defaults. Any positive value goes on the wire verbatim.
    const maxTokens =
      opts.maxTokens === 0 ? undefined : opts.maxTokens ?? this.defaultMaxTokens;
    return {
      model,
      messages,
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(opts.tools && opts.tools.length > 0
        ? {
            tools: opts.tools.map(
              (t): OpenRouterTool => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              }),
            ),
          }
        : {}),
    };
  }

  private recordCost(response: OpenRouterResponse): void {
    const usage = response.usage;
    if (!usage) return;
    this.costTracker.record({
      model: response.model,
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      costUsd: usage.cost ?? 0,
    });
  }
}

/** Translate one generic `LlmMessage` into one or more OpenRouter-shaped
 * messages. Plain string content passes through. A block array is split by
 * type: `text` → collapsed into `content`, `tool_use` → moved onto the
 * assistant message's `tool_calls`, `tool_result` → emitted as a separate
 * `role: "tool"` message (OpenAI's convention). Returning an array so
 * `flatMap` in `buildRequest` handles the fan-out uniformly. */
function toOpenRouterMessages(message: LlmMessage): OpenRouterMessage[] {
  if (typeof message.content === "string") {
    return [{ role: message.role, content: message.content }];
  }

  // Split blocks into their three flavors so we can shape the OpenAI-compat
  // wire form: assistant → one message with text+tool_calls, user →
  // {text-message?} + {one tool message per tool_result}.
  const textParts: string[] = [];
  const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
  const toolResults: Array<{ toolUseId: string; content: string }> = [];
  for (const block of message.content) {
    if (block.type === "text") textParts.push(block.text);
    else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    } else if (block.type === "tool_result") {
      toolResults.push({ toolUseId: block.toolUseId, content: block.content });
    }
  }

  const out: OpenRouterMessage[] = [];
  const textContent = textParts.join("");
  if (message.role === "assistant") {
    // OpenAI requires `content: null` when only tool_calls are present; a
    // string (even empty) alongside tool_calls is fine too, but null is more
    // faithful to what the model actually produced.
    out.push({
      role: "assistant",
      content: textContent.length > 0 ? textContent : null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  } else {
    if (textContent.length > 0) out.push({ role: "user", content: textContent });
    for (const r of toolResults) {
      out.push({ role: "tool", content: r.content, tool_call_id: r.toolUseId });
    }
  }
  return out;
}

function buildRequestOptions(opts: LlmSendOptions): OpenRouterRequestOptions {
  return {
    ...(opts.responseCacheTtlSeconds !== undefined ? { responseCacheTtlSeconds: opts.responseCacheTtlSeconds } : {}),
  };
}

/** Switches a message's content to the block-array form `cache_control`
 * requires. No-op when `cacheControl` is undefined; also a no-op when
 * `content` is `null` (assistant-with-only-tool-calls has no text to mark). */
function withCacheControl(message: OpenRouterMessage, cacheControl: OpenRouterCacheControl | undefined): OpenRouterMessage {
  if (!cacheControl) return message;
  if (message.content === null) return message;
  const text =
    typeof message.content === "string" ? message.content : message.content.map((b) => b.text).join("");
  return { ...message, content: [{ type: "text", text, cache_control: cacheControl }] };
}

function toTextResult(response: OpenRouterResponse): LlmTextResult {
  const usage = response.usage;
  const choice = response.choices[0];
  const content = choice?.message.content ?? null;
  const rawToolCalls = choice?.message.tool_calls ?? [];
  const toolUses: LlmToolUse[] = rawToolCalls.map((c) => ({
    id: c.id,
    name: c.function.name,
    input: parseToolArguments(c.function.arguments),
  }));
  // Silent-refusal check applies only when the model produced NEITHER text
  // NOR tool_calls. A tool-only response with `content: null` is legitimate
  // and shouldn't throw.
  if (!content && toolUses.length === 0) {
    throw new OpenRouterEmptyResponseError(choice?.finish_reason ?? null, response);
  }
  return {
    text: content ?? "",
    model: response.model,
    usage: { inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 },
    ...(toolUses.length > 0 ? { toolUses } : {}),
    stopReason: toStopReason(choice?.finish_reason ?? null),
  };
}

/** OpenAI's `function.arguments` is a JSON string. Return the parsed value
 * when it's valid JSON, or the raw string when it isn't — tools can then
 * decide whether to accept partial/malformed input. */
function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Map OpenAI's finish_reason strings into our normalized `LlmStopReason`.
 * Anything unrecognized becomes `"other"` — we surface it rather than
 * throwing so a caller can log and continue. */
function toStopReason(raw: string | null): LlmTextResult["stopReason"] {
  switch (raw) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "other";
    default:
      return raw === null ? undefined : "other";
  }
}
