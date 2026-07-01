/**
 * OpenRouter public surface. Excludes `fixtures.ts` (Node `fs`-only,
 * test/tooling) for the same reason `src/claude/index.ts` excludes its
 * equivalent — it would break under Metro if pulled into the app bundle.
 */

export { OpenRouterClient, StructuredOutputError, type OpenRouterClientOptions } from "./client";
export { listOpenRouterModels } from "./models";
export { RealOpenRouterTransport, type RealOpenRouterTransportOptions } from "./realTransport";
export { type ResolvedRetryOptions, type RetryOptions, isRetryableOpenRouterError } from "./retry";
export type {
  OpenRouterMessage,
  OpenRouterMessageStream,
  OpenRouterRequest,
  OpenRouterResponse,
  OpenRouterTool,
  OpenRouterToolChoice,
  OpenRouterTransport,
} from "./types";
export { OpenRouterApiError } from "./types";
