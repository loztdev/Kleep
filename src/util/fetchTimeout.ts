/**
 * Shared timeout/cancellation wrapper for one-shot network fetches
 * (model catalogs, the prompt library) — extracted out of
 * `src/llm/modelCatalog.ts` once a second, non-LLM consumer needed the
 * identical logic. Avoids `AbortSignal.timeout`/`.any`: not guaranteed
 * present on Hermes, the RN JS engine this app ships on.
 */

/** How long a one-shot fetch gets before it's aborted as hung. */
export const FETCH_TIMEOUT_MS = 10_000;

/**
 * Runs `fn` with an `AbortSignal` that fires after `FETCH_TIMEOUT_MS`
 * or when `external` (e.g. a modal unmounting) aborts first, whichever
 * comes first.
 */
export async function withFetchTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  external?.addEventListener("abort", onExternalAbort);
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeout);
    external?.removeEventListener("abort", onExternalAbort);
  }
}
