/**
 * Tier 5.5 — Claude API client public surface.
 *
 * Deliberately excludes `fixtures.ts` (Node `fs`-only, test/tooling) and
 * `secureKeyStore.ts` (native `expo-secure-store` module) — both would
 * break under Jest or Metro if pulled into this barrel. Import them
 * directly by path where needed.
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
