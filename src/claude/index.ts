/**
 * Tier 5.5 — Claude API client public surface.
 *
 * Deliberately excludes `fixtures.ts` (Node `fs`-only, test/tooling) — it
 * would break under Jest if pulled into this barrel. Import it directly
 * by path where needed. Secure API key storage lives at
 * `src/llm/secureKeyStore.ts` (provider-agnostic, native `expo-secure-store`
 * module — same reasoning, different file).
 */

export {
  ClaudeClient,
  StructuredOutputError,
  type ClaudeClientOptions,
  type SendMessageOptions,
  type StructuredOutputOptions,
  type StructuredOutputResult,
} from "./client";
export { CostTracker, DEFAULT_PRICING, type CostEntry, type ModelPricing } from "./costTracker";
export { RealTransport, type RealTransportOptions } from "./realTransport";
export {
  type ResolvedRetryOptions,
  type RetryOptions,
  isRetryableError,
  withRetry,
} from "./retry";
export type {
  ClaudeMessageStream,
  ClaudeRequest,
  ClaudeStreamChunk,
  ClaudeStreamHandle,
  ClaudeTransport,
} from "./types";
export { type ToolInputSchema, zodToToolInputSchema } from "./zodToJsonSchema";
