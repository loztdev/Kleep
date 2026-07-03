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

/**
 * Re-exported under the original names — this used to be a model-catalog-
 * only helper; the prompt library needed the identical timeout/cancellation
 * logic, so it moved to `src/util/fetchTimeout.ts`. Kept here so
 * `src/claude/models.ts`/`src/llm/openrouter/models.ts` don't need to change.
 */
export { FETCH_TIMEOUT_MS as MODEL_FETCH_TIMEOUT_MS, withFetchTimeout as withModelFetchTimeout } from "../util/fetchTimeout";
