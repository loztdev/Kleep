/**
 * Fetches Anthropic's live model catalog (`GET /v1/models`) for the model
 * picker — unlike OpenRouter's equivalent, this needs the API key
 * (`x-api-key` + `anthropic-version` headers, no SDK call for this one:
 * `@anthropic-ai/sdk` doesn't expose a typed models-list method as of the
 * version pinned here, and a plain fetch is simpler than adding one).
 */

import type { ModelInfo } from "../llm/modelCatalog";

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicModelsResponse {
  data: Array<{ id: string; display_name?: string }>;
}

/** List every model available to this API key, most-recent first (Anthropic's own ordering). */
export async function listClaudeModels(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelInfo[]> {
  const res = await fetchImpl(ANTHROPIC_MODELS_URL, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Claude models: HTTP ${res.status}`);
  }
  const body = (await res.json()) as AnthropicModelsResponse;
  return body.data.map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
}
