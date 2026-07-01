/**
 * Retry-with-jitter for transient OpenRouter failures (429 rate limits,
 * any 5xx, and network-level fetch failures). Backoff math lives in
 * `src/llm/retry.ts`, shared with the Claude client.
 */

import {
  type ResolvedRetryOptions,
  type RetryOptions as GenericRetryOptions,
  defaultSleep,
  resolveRetryOptions as resolveGenericRetryOptions,
  withRetry,
} from "../retry";
import { OpenRouterApiError } from "./types";

/** Construction options for the retry loop. All fields are optional; see defaults in `client.ts`. */
export type RetryOptions = Omit<GenericRetryOptions, "isRetryable">;

export type { ResolvedRetryOptions };
export { defaultSleep, withRetry };

/** True for 429 / any 5xx OpenRouter API error, or a `fetch`-level network failure — the cases worth retrying. */
export function isRetryableOpenRouterError(err: unknown): boolean {
  if (err instanceof OpenRouterApiError) {
    return err.status === 429 || err.status >= 500;
  }
  // `fetch` throws a TypeError for DNS/connection-level failures (no HTTP response at all).
  if (err instanceof TypeError) return true;
  return false;
}

/** Resolve partial `RetryOptions` into a fully-defaulted config, defaulting `isRetryable` to the OpenRouter-specific predicate. */
export function resolveRetryOptions(opts: RetryOptions = {}): ResolvedRetryOptions {
  return resolveGenericRetryOptions({ ...opts, isRetryable: isRetryableOpenRouterError });
}
