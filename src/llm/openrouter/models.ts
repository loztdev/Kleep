/**
 * Fetches OpenRouter's live model catalog (`GET /api/v1/models`) for the
 * model picker — public, no API key needed, unlike Claude's equivalent
 * (`src/claude/models.ts`).
 */

import type { ModelInfo } from "../modelCatalog";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

interface OpenRouterModelsResponse {
  data: Array<{ id: string; name?: string; description?: string }>;
}

/** List every model OpenRouter currently offers. */
export async function listOpenRouterModels(fetchImpl: typeof fetch = fetch): Promise<ModelInfo[]> {
  const res = await fetchImpl(OPENROUTER_MODELS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch OpenRouter models: HTTP ${res.status}`);
  }
  const body = (await res.json()) as OpenRouterModelsResponse;
  return body.data.map((m) => ({
    id: m.id,
    label: m.name ?? m.id,
    ...(m.description ? { description: m.description } : {}),
  }));
}
