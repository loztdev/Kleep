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
} from "../types";
import { zodToToolInputSchema } from "../zodToJsonSchema";
import { RealOpenRouterTransport, type RealOpenRouterTransportOptions } from "./realTransport";
import { type ResolvedRetryOptions, type RetryOptions, resolveRetryOptions, withRetry } from "./retry";
import type {
  OpenRouterMessage,
  OpenRouterRequest,
  OpenRouterResponse,
  OpenRouterTool,
  OpenRouterTransport,
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
    const response = await withRetry(() => this.transport.send(request), this.retryOptions);
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

    const response = await withRetry(() => this.transport.send(request), this.retryOptions);
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
    const stream = this.transport.stream(request);

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
    const messages: OpenRouterMessage[] = [
      ...(opts.system !== undefined ? [{ role: "system" as const, content: opts.system }] : []),
      ...opts.messages.map(toOpenRouterMessage),
    ];
    return {
      model,
      messages,
      max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
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

function toOpenRouterMessage(message: LlmMessage): OpenRouterMessage {
  return { role: message.role, content: message.content };
}

function toTextResult(response: OpenRouterResponse): LlmTextResult {
  const usage = response.usage;
  return {
    text: response.choices[0]?.message.content ?? "",
    model: response.model,
    usage: { inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 },
  };
}
