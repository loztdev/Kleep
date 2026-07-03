/**
 * OpenRouter wire types — OpenAI-compatible Chat Completions shape.
 * https://openrouter.ai/docs/api-reference/chat-completion
 */

/**
 * Anthropic-style cache breakpoint, passed straight through by OpenRouter to
 * Claude models — same shape and same `5m`/`1h` TTL limit as calling
 * Anthropic directly. See `src/llm/types.ts`'s `CacheTtl` doc.
 */
export interface OpenRouterCacheControl {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

/** One block of a content-array message — the form required to attach `cache_control` to a specific block. */
export interface OpenRouterTextContentBlock {
  type: "text";
  text: string;
  cache_control?: OpenRouterCacheControl;
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  /** Plain string for the common case; a content-block array only when a block needs `cache_control`. */
  content: string | OpenRouterTextContentBlock[];
}

/** JSON-schema-shaped function tool, OpenAI function-calling convention. */
export interface OpenRouterTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export type OpenRouterToolChoice = "auto" | "none" | { type: "function"; function: { name: string } };

/** Request body sent to `POST /chat/completions`. */
export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  max_tokens?: number;
  tools?: OpenRouterTool[];
  tool_choice?: OpenRouterToolChoice;
}

export interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Actual USD cost of this generation — populated when the request opts in via `usage: { include: true }`. */
  cost?: number;
}

export interface OpenRouterChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: OpenRouterToolCall[];
  };
  finish_reason: string | null;
}

/** Non-streaming response from `POST /chat/completions`. */
export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: OpenRouterChoice[];
  usage?: OpenRouterUsage;
}

/** One SSE `data:` chunk from a streaming response. */
export interface OpenRouterStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: OpenRouterUsage;
}

/** A streamed response in progress — async-iterate `chunks`, or await `finalMessage()` for the accumulated result. */
export interface OpenRouterMessageStream extends AsyncIterable<OpenRouterStreamChunk> {
  finalMessage(): Promise<OpenRouterResponse>;
}

/**
 * Transport-level (not request-body) knobs — currently just OpenRouter's
 * *response* cache, an exact-request memoization layer at OpenRouter itself
 * (unrelated to `cache_control` prompt caching above), toggled via headers
 * rather than a body field.
 */
export interface OpenRouterRequestOptions {
  /** Sets `X-OpenRouter-Cache: true` + `X-OpenRouter-Cache-TTL`. Seconds, 1–86400. Omit to leave response caching off. */
  responseCacheTtlSeconds?: number;
}

/** Seam between `OpenRouterClient` and the actual transport (real HTTP vs. fixture replay). */
export interface OpenRouterTransport {
  send(request: OpenRouterRequest, opts?: OpenRouterRequestOptions): Promise<OpenRouterResponse>;
  stream(request: OpenRouterRequest, opts?: OpenRouterRequestOptions): OpenRouterMessageStream;
}

/** Thrown for any non-2xx HTTP response from the OpenRouter API. */
export class OpenRouterApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OpenRouterApiError";
  }
}
