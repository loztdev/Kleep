/**
 * Tier 5.5 — Claude API client.
 *
 * Thin orchestration layer over a `ClaudeTransport`: retry with jitter on
 * transient failures, per-call cost accounting, a Zod-backed structured-
 * output helper (forces a tool call and validates the result), and basic
 * streaming for the chat surface (Tier 7).
 *
 * Auth is intentionally out of scope here — `ClaudeClient` just takes an
 * `apiKey` string or a pre-built `ClaudeTransport`. Loading the key from
 * Expo SecureStore is `src/llm/secureKeyStore.ts`'s job, kept separate so this
 * module (and its tests) never touch a native module.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { CostTracker } from "./costTracker";
import { RealTransport } from "./realTransport";
import { type ResolvedRetryOptions, type RetryOptions, resolveRetryOptions, withRetry } from "./retry";
import type {
  ClaudeRequest,
  ClaudeStreamChunk,
  ClaudeStreamHandle,
  ClaudeTransport,
} from "./types";
import { zodToToolInputSchema } from "./zodToJsonSchema";

/** Construction options for `ClaudeClient`. */
export interface ClaudeClientOptions {
  /** Anthropic API key. Required unless `transport` is supplied directly (e.g. `FixtureTransport` in tests). */
  apiKey?: string;
  /** Override the API host — passed through to `RealTransport`. Ignored if `transport` is supplied. */
  baseURL?: string;
  /** Pre-built transport — bypasses `apiKey`/`baseURL`. Used by tests (`FixtureTransport`) and by callers wiring their own. */
  transport?: ClaudeTransport;
  /** Model used when a call doesn't specify one. Default `"claude-opus-4-8"`. */
  defaultModel?: string;
  /** `max_tokens` used when a call doesn't specify one. Default 4096. */
  defaultMaxTokens?: number;
  /** Shared cost tracker. Defaults to a fresh `CostTracker`. */
  costTracker?: CostTracker;
  /** Retry/backoff tuning — see `RetryOptions`. */
  retry?: RetryOptions;
}

/** Options shared by every message-sending call. */
export interface SendMessageOptions {
  messages: readonly Anthropic.MessageParam[];
  system?: string;
  model?: string;
  maxTokens?: number;
  tools?: readonly Anthropic.Tool[];
  toolChoice?: Anthropic.ToolChoice;
  /**
   * Request automatic (top-level) prompt caching — see `ClaudeRequest.cache_control`.
   * Only worth setting on calls whose `messages` will grow past the target
   * model's minimum cacheable token count (e.g. multi-turn chat); short,
   * single-shot prompts (extraction, summarization) won't cross that floor
   * and gain nothing from it.
   */
  cache?: boolean;
}

/** Options for `ClaudeClient.structured` — a single named tool the model is forced to call. */
export interface StructuredOutputOptions<T> {
  messages: readonly Anthropic.MessageParam[];
  system?: string;
  model?: string;
  maxTokens?: number;
  tool: {
    name: string;
    description: string;
    schema: z.ZodType<T>;
  };
}

/** Result of a successful `ClaudeClient.structured` call. */
export interface StructuredOutputResult<T> {
  data: T;
  message: Anthropic.Message;
}

/** Thrown when Claude doesn't return the requested tool call, or its input fails schema validation. */
export class StructuredOutputError extends Error {
  constructor(
    message: string,
    public readonly response: Anthropic.Message,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/** Claude API client: retry, cost tracking, structured output, and streaming over a pluggable transport. */
export class ClaudeClient {
  readonly costTracker: CostTracker;
  private readonly transport: ClaudeTransport;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;
  private readonly retryOptions: ResolvedRetryOptions;

  constructor(opts: ClaudeClientOptions) {
    if (opts.transport) {
      this.transport = opts.transport;
    } else {
      if (!opts.apiKey) {
        throw new Error("ClaudeClient requires either `apiKey` or `transport`");
      }
      this.transport = new RealTransport({ apiKey: opts.apiKey, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) });
    }
    this.defaultModel = opts.defaultModel ?? "claude-opus-4-8";
    this.defaultMaxTokens = opts.defaultMaxTokens ?? 4096;
    this.costTracker = opts.costTracker ?? new CostTracker();
    this.retryOptions = resolveRetryOptions(opts.retry);
  }

  /** Send one non-streaming message and return the full `Message`. Retries on transient failure; records cost. */
  async sendMessage(opts: SendMessageOptions): Promise<Anthropic.Message> {
    const request = this.buildRequest(opts);
    const message = await withRetry(() => this.transport.send(request), this.retryOptions);
    this.costTracker.record(message.model, message.usage);
    return message;
  }

  /**
   * Force a single named tool call and validate its `input` against
   * `tool.schema`. Throws `StructuredOutputError` if Claude doesn't call
   * the tool, or if the call doesn't validate.
   */
  async structured<T>(opts: StructuredOutputOptions<T>): Promise<StructuredOutputResult<T>> {
    const inputSchema = zodToToolInputSchema(opts.tool.schema);
    const tool: Anthropic.Tool = {
      name: opts.tool.name,
      description: opts.tool.description,
      input_schema: inputSchema,
    };
    const message = await this.sendMessage({
      messages: opts.messages,
      ...(opts.system !== undefined ? { system: opts.system } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      tools: [tool],
      toolChoice: { type: "tool", name: opts.tool.name },
    });

    const block = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.tool.name,
    );
    if (!block) {
      throw new StructuredOutputError(`Claude did not return a "${opts.tool.name}" tool call`, message);
    }
    const parsed = opts.tool.schema.safeParse(block.input);
    if (!parsed.success) {
      throw new StructuredOutputError(
        `"${opts.tool.name}" tool call failed schema validation: ${parsed.error.message}`,
        message,
      );
    }
    return { data: parsed.data, message };
  }

  /**
   * Stream a message. `chunks` yields incremental text/thinking deltas;
   * `final` resolves to the complete `Message` once streaming finishes
   * (and records cost at that point). Streaming requests are not retried —
   * once partial output has reached the caller, replaying the request
   * would duplicate it.
   */
  streamMessage(opts: SendMessageOptions): ClaudeStreamHandle {
    const request = this.buildRequest(opts);
    const claudeStream = this.transport.stream(request);
    const costTracker = this.costTracker;

    let resolveFinal!: (message: Anthropic.Message) => void;
    let rejectFinal!: (err: unknown) => void;
    const final = new Promise<Anthropic.Message>((resolve, reject) => {
      resolveFinal = resolve;
      rejectFinal = reject;
    });
    // Unhandled-rejection guard: a caller who never awaits `final` (e.g.
    // only drains `chunks`) shouldn't crash the process on a stream error.
    final.catch(() => undefined);

    // Drains chunks into a queue immediately — NOT lazily inside the
    // `chunks` generator below. `async function*` bodies don't start
    // running until first iterated, so if consumption lived there, a
    // caller who only awaits `final` (never touching `chunks`) would
    // leave the underlying stream un-consumed and `final` would hang
    // forever. Driving it here means `final` settles regardless of
    // whether — or how — the caller drains `chunks`.
    const queue: ClaudeStreamChunk[] = [];
    let queueWaiters: Array<() => void> = [];
    let finished = false;
    let failure: { error: unknown } | null = null;
    const wake = (): void => {
      const waiters = queueWaiters;
      queueWaiters = [];
      waiters.forEach((resolve) => resolve());
    };

    (async () => {
      try {
        for await (const event of claudeStream) {
          const chunk = toStreamChunk(event);
          if (chunk) {
            queue.push(chunk);
            wake();
          }
        }
        const message = await claudeStream.finalMessage();
        costTracker.record(message.model, message.usage);
        resolveFinal(message);
      } catch (err) {
        failure = { error: err };
        rejectFinal(err);
      } finally {
        finished = true;
        wake();
      }
    })();

    async function* chunks(): AsyncGenerator<ClaudeStreamChunk, void, void> {
      let i = 0;
      for (;;) {
        while (i < queue.length) yield queue[i++]!;
        if (finished) {
          if (failure) throw failure.error;
          return;
        }
        await new Promise<void>((resolve) => queueWaiters.push(resolve));
      }
    }

    return { chunks: chunks(), final };
  }

  private buildRequest(opts: SendMessageOptions): ClaudeRequest {
    return {
      model: opts.model ?? this.defaultModel,
      max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
      messages: [...opts.messages],
      ...(opts.system !== undefined ? { system: opts.system } : {}),
      ...(opts.tools !== undefined ? { tools: [...opts.tools] } : {}),
      ...(opts.toolChoice !== undefined ? { tool_choice: opts.toolChoice } : {}),
      ...(opts.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    };
  }
}

/** Map one raw SDK stream event to a simplified `ClaudeStreamChunk`, or `null` for events we don't surface. */
function toStreamChunk(event: Anthropic.MessageStreamEvent): ClaudeStreamChunk | null {
  if (event.type !== "content_block_delta") return null;
  if (event.delta.type === "text_delta") return { type: "text", text: event.delta.text };
  if (event.delta.type === "thinking_delta") return { type: "thinking", text: event.delta.thinking };
  return null;
}
