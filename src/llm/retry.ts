/**
 * Provider-agnostic retry-with-jitter loop. Each provider supplies its own
 * `isRetryable` predicate (an Anthropic `APIError` shape differs from an
 * HTTP `Response`/`fetch` failure), but the backoff math itself — and the
 * injectable `sleep`/`jitter` seams tests rely on — only needs to exist
 * once. `src/claude/retry.ts` wraps this with the Anthropic-specific
 * predicate as its default.
 */

/** Construction options for the retry loop. `isRetryable` has no sensible cross-provider default — callers must supply one. */
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
  /** Returns true if `err` is worth retrying (rate limit, overloaded, 5xx, network failure). */
  isRetryable: (err: unknown) => boolean;
}

/** Fully-resolved retry options as used internally by `withRetry`. */
export type ResolvedRetryOptions = Required<RetryOptions>;

/** Default real-time sleep — `await`s a `setTimeout`. */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve partial `RetryOptions` into a fully-defaulted config. `isRetryable` is required — there's no safe universal default. */
export function resolveRetryOptions(opts: RetryOptions): ResolvedRetryOptions {
  return {
    maxRetries: opts.maxRetries ?? 3,
    baseDelayMs: opts.baseDelayMs ?? 500,
    maxDelayMs: opts.maxDelayMs ?? 8000,
    sleep: opts.sleep ?? defaultSleep,
    jitter: opts.jitter ?? Math.random,
    isRetryable: opts.isRetryable,
  };
}

/**
 * Run `fn`, retrying on `opts.isRetryable` with exponential backoff plus
 * jitter (50%–100% of the computed delay). Re-throws immediately on a
 * non-retryable error, or once `maxRetries` attempts have been exhausted.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: ResolvedRetryOptions): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.maxRetries || !opts.isRetryable(err)) throw err;
      const exponential = opts.baseDelayMs * 2 ** attempt;
      const delay = Math.min(opts.maxDelayMs, exponential) * (0.5 + opts.jitter() * 0.5);
      await opts.sleep(delay);
      attempt++;
    }
  }
}
