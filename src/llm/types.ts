/**
 * Provider-agnostic LLM client surface.
 *
 * `ClaudeClient` (src/claude/) stays Anthropic-shaped — message content as
 * blocks, tool_use content blocks, etc. — because that's the SDK's native
 * fidelity and there's real value in keeping it 1:1 with the Messages API.
 * This interface is the generic seam everything else (extraction,
 * summarization, the chat screen) is written against, so any of those
 * components can run on Claude, OpenRouter, or a future provider without
 * caring which one it is.
 */

import type { z } from "zod";

/** A single turn in a generic chat-shaped conversation. */
export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Cache breakpoint lifetime for `cache`. This is Anthropic's own limit
 * (`5m` or `1h`, nothing in between or beyond) — OpenRouter passes Claude
 * requests straight through to Anthropic unchanged, so the same two values
 * are all either path supports. Omitting it defaults to `5m`.
 */
export type CacheTtl = "5m" | "1h";

/** Options shared by every message-sending call. */
export interface LlmSendOptions {
  messages: readonly LlmMessage[];
  system?: string;
  model?: string;
  maxTokens?: number;
  /**
   * Request prompt caching (Anthropic's `cache_control`), where the
   * underlying provider/model supports it — Claude directly, or Claude
   * models routed through OpenRouter (passed through to the same
   * mechanism). Providers with no such concept (e.g. non-Claude models via
   * OpenRouter) just ignore the field. Only worth setting on calls whose
   * `messages` will grow past the target model's minimum cacheable token
   * count — see `SendMessageOptions.cache` in `src/claude/client.ts`.
   */
  cache?: boolean;
  /** TTL for `cache`'s breakpoint. Ignored if `cache` is falsy. Defaults to `5m`. */
  cacheTtl?: CacheTtl;
  /**
   * OpenRouter-only: opt into OpenRouter's *response* cache — an exact-request
   * memoization layer at OpenRouter itself, unrelated to provider-side prompt
   * caching above. A hit only happens when a later call is byte-identical to
   * this one (same messages, same everything), so it rarely fires mid-chat;
   * it mainly helps with accidental duplicate calls (e.g. a double-tapped
   * regenerate). Value is the cache lifetime in seconds (1–86400). Ignored by
   * `ClaudeProvider`.
   */
  responseCacheTtlSeconds?: number;
}

/** Token usage for one call, normalized across providers. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Result of a non-streaming `sendMessage` call. */
export interface LlmTextResult {
  text: string;
  model: string;
  usage: LlmUsage;
}

/** Options for `structured` — a single named tool the model is forced to call. */
export interface LlmStructuredOptions<T> extends LlmSendOptions {
  tool: {
    name: string;
    description: string;
    schema: z.ZodType<T>;
  };
}

/** Result of a successful `structured` call. */
export interface LlmStructuredResult<T> {
  data: T;
}

/** One incremental piece of a streamed response. */
export type LlmStreamChunk = { type: "text"; text: string };

/** Returned by `streamMessage` — drain `chunks` for incremental text, await `final` for the complete result. */
export interface LlmStreamHandle {
  chunks: AsyncGenerator<LlmStreamChunk, void, void>;
  final: Promise<LlmTextResult>;
}

/** Provider-agnostic LLM client. `ClaudeProvider` and `OpenRouterClient` both implement this. */
export interface LlmProvider {
  /** Short identifier for logs/UI — e.g. `"claude"`, `"openrouter"`. */
  readonly name: string;
  /** Running total cost (USD) across every call made through this provider instance. */
  totalCostUsd(): number;
  sendMessage(opts: LlmSendOptions): Promise<LlmTextResult>;
  structured<T>(opts: LlmStructuredOptions<T>): Promise<LlmStructuredResult<T>>;
  streamMessage(opts: LlmSendOptions): LlmStreamHandle;
}
