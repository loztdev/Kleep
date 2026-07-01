/**
 * Provider-agnostic shape for the model picker (`ModelPickerModal.tsx`) —
 * both `listOpenRouterModels()` and `listClaudeModels()` normalize into
 * this so the UI doesn't need to know which provider it's browsing.
 */
export interface ModelInfo {
  id: string;
  label: string;
  description?: string;
}

/** How long a model-catalog fetch gets before it's aborted as hung. */
export const MODEL_FETCH_TIMEOUT_MS = 10_000;

/**
 * Runs `fn` with an `AbortSignal` that fires after `MODEL_FETCH_TIMEOUT_MS`
 * or when `external` (e.g. `ModelPickerModal` unmounting) aborts first,
 * whichever comes first. Avoids `AbortSignal.timeout`/`.any` — not
 * guaranteed present on Hermes, the RN JS engine this app ships on.
 */
export async function withModelFetchTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  external?.addEventListener("abort", onExternalAbort);
  const timeout = setTimeout(() => controller.abort(), MODEL_FETCH_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeout);
    external?.removeEventListener("abort", onExternalAbort);
  }
}
