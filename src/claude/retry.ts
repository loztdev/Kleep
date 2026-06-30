/**
 * Retry-with-jitter for transient Claude API failures (429 rate limits,
 * 529 overloaded, 5xx, and network-level connection errors).
 *
 * `sleep` and `jitter` are injectable so tests can run the full backoff
 * loop without real wall-clock delay or non-deterministic timing.
 */

import Anthropic from "@anthropic-ai/sdk";

/** Construction options for the retry loop. All fields are optional; see defaults in `client.ts`. */
export interface RetryOptions {
  /** Number of retries after the first attempt. Default 3. */
  maxRetries?: number;
  /** Base delay in ms before exponential backoff. Default 500. */
  baseDelayMs?: number;
  /** Ceiling on the backoff delay, before jitter is applied. Default 8000. */
  maxDelayMs?: number;
  /** Injectable delay function — defaults to a real `setTimeout`-backed sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable source of randomness in [0, 1) for jitter. Defaults to `Math.random`. */
  jitter?: () => number;
}

/** Fully-resolved retry options (every field required) as used internally by `withRetry`. */
export type ResolvedRetryOptions = Required<RetryOptions>;

/** Default real-time sleep — `await`s a `setTimeout`. */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve partial `RetryOptions` into a fully-defaulted config. */
export function resolveRetryOptions(opts: RetryOptions = {}): ResolvedRetryOptions {
  return {
    maxRetries: opts.maxRetries ?? 3,
    baseDelayMs: opts.baseDelayMs ?? 500,
    maxDelayMs: opts.maxDelayMs ?? 8000,
    sleep: opts.sleep ?? defaultSleep,
    jitter: opts.jitter ?? Math.random,
  };
}

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

/**
 * Run `fn`, retrying on `isRetryableError` with exponential backoff plus
 * jitter (50%–100% of the computed delay). Re-throws immediately on a
 * non-retryable error, or once `maxRetries` attempts have been exhausted.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: ResolvedRetryOptions): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.maxRetries || !isRetryableError(err)) throw err;
      const exponential = opts.baseDelayMs * 2 ** attempt;
      const delay = Math.min(opts.maxDelayMs, exponential) * (0.5 + opts.jitter() * 0.5);
      await opts.sleep(delay);
      attempt++;
    }
  }
}
