/**
 * Retry-with-jitter for transient Claude API failures (429 rate limits,
 * 529 overloaded, 5xx, and network-level connection errors).
 *
 * The backoff loop itself lives in `src/llm/retry.ts` (shared with
 * OpenRouter); this module just supplies the Anthropic-specific
 * `isRetryable` predicate as the default.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  type ResolvedRetryOptions as GenericResolvedRetryOptions,
  type RetryOptions as GenericRetryOptions,
  defaultSleep,
  resolveRetryOptions as resolveGenericRetryOptions,
  withRetry,
} from "../llm/retry";

/** Construction options for the retry loop. All fields are optional; see defaults in `client.ts`. */
export type RetryOptions = Omit<GenericRetryOptions, "isRetryable">;

/** Fully-resolved retry options (every field required) as used internally by `withRetry`. */
export type ResolvedRetryOptions = GenericResolvedRetryOptions;

export { defaultSleep, withRetry };

/** True for 429 / 529 / any 5xx Claude API error, or a connection-level failure — the cases worth retrying. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    if (status === 429 || status === 529) return true;
    if (typeof status === "number" && status >= 500) return true;
  }
  return false;
}

/** Resolve partial `RetryOptions` into a fully-defaulted config, defaulting `isRetryable` to the Claude-specific predicate. */
export function resolveRetryOptions(opts: RetryOptions = {}): ResolvedRetryOptions {
  return resolveGenericRetryOptions({ ...opts, isRetryable: isRetryableError });
}
