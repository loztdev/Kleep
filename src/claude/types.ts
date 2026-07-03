/**
 * Tier 5.5 — Claude API client interfaces.
 *
 * `ClaudeTransport` is the seam between the client's retry/cost/structured-
 * output logic and how a request actually reaches Anthropic. Production
 * code uses `RealTransport` (wraps `@anthropic-ai/sdk`); tests use
 * `FixtureTransport` (records/replays JSON fixtures) so the suite never
 * makes a network call.
 */

import type Anthropic from "@anthropic-ai/sdk";

/**
 * Wire shape sent to the Messages API — a thin, retry-friendly subset of
 * `MessageCreateParamsBase`. Arrays are mutable to match the SDK's own
 * params types; `ClaudeClient` copies caller-supplied arrays when building
 * this from the public (readonly) `SendMessageOptions`.
 */
export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: Anthropic.MessageParam[];
  system?: string;
  tools?: Anthropic.Tool[];
  tool_choice?: Anthropic.ToolChoice;
  /**
   * Top-level (automatic) prompt caching — a single marker that caches
   * everything up to the last cacheable block and moves forward as the
   * conversation grows, no per-block bookkeeping needed. See
   * docs/build-with-claude/prompt-caching.
   */
  cache_control?: Anthropic.CacheControlEphemeral;
}

/** A streamed message in progress — implements both async iteration and the SDK's `finalMessage()` convenience. */
export interface ClaudeMessageStream extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
}

/** Seam between `ClaudeClient` and the actual transport (real HTTP vs. fixture replay). */
export interface ClaudeTransport {
  send(request: ClaudeRequest): Promise<Anthropic.Message>;
  stream(request: ClaudeRequest): ClaudeMessageStream;
}

/** One incremental piece of a streamed response, simplified from the SDK's raw stream events. */
export type ClaudeStreamChunk =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string };

/** Returned by `ClaudeClient.streamMessage` — drain `chunks` for incremental text, await `final` for usage/cost. */
export interface ClaudeStreamHandle {
  chunks: AsyncGenerator<ClaudeStreamChunk, void, void>;
  final: Promise<Anthropic.Message>;
}
