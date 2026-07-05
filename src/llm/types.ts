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

/**
 * A single turn in a generic chat-shaped conversation.
 *
 * `content` is either a plain string (the common case — a normal text turn)
 * OR an array of typed content blocks. The block-array form is what tool-use
 * loops require: an assistant turn can carry a mix of `text` and `tool_use`
 * blocks (the model spoke and asked to call tools), and the next user turn
 * can carry `tool_result` blocks reporting how those calls resolved. Providers
 * translate this shape to/from their native representation.
 */
export interface LlmMessage {
  role: "user" | "assistant";
  content: string | readonly LlmContentBlock[];
}

/** One block within a `LlmMessage.content` array. */
export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

/**
 * Definition of a tool the model may call during `sendMessage`. Providers
 * translate `inputSchema` (JSON Schema, as an object) directly to their
 * native tool definition — Anthropic reads it as `input_schema`, OpenRouter/
 * OpenAI-compat reads it as `parameters`.
 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** One tool call the model produced in response. `input` is the arguments
 * object, matching the tool's declared `inputSchema`. */
export interface LlmToolUse {
  id: string;
  name: string;
  input: unknown;
}

/**
 * Result the caller reports back for one `LlmToolUse`. Feed this into the
 * *next* `sendMessage`'s `messages` as part of a user turn's content-block
 * array so the model can continue reasoning with the tool's output visible.
 */
export interface LlmToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

/**
 * Why the model stopped emitting. `"tool_use"` means the response carries at
 * least one `tool_use` block and the caller is expected to execute the tools
 * and continue the loop with a follow-up `sendMessage`. `"end_turn"` means
 * the model considers the conversation-turn complete.
 */
export type LlmStopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "other";

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
  /**
   * Tools the model may call. Empty/omitted means a plain text response is
   * expected. When provided, the result may include `toolUses` and the
   * `stopReason` may be `"tool_use"` — the caller is expected to execute
   * each tool and continue the loop with a follow-up `sendMessage`.
   */
  tools?: readonly LlmToolDefinition[];
}

/** Token usage for one call, normalized across providers. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Result of a non-streaming `sendMessage` call. `text` collects every `text`
 * block the model emitted; `toolUses` collects every `tool_use` block. When
 * the model requested tool calls, `toolUses` is populated AND `stopReason`
 * is `"tool_use"` — same signal from two angles.
 */
export interface LlmTextResult {
  text: string;
  model: string;
  usage: LlmUsage;
  toolUses?: LlmToolUse[];
  stopReason?: LlmStopReason;
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
