/**
 * Provider-agnostic shape for the model picker (`ModelPickerScreen.tsx`) —
 * both `listOpenRouterModels()` and `listClaudeModels()` normalize into
 * this so the UI doesn't need to know which provider it's browsing.
 */
export interface ModelInfo {
  id: string;
  label: string;
  description?: string;
}
