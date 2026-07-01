/**
 * Factory: build the concrete `LlmProvider` for a saved (kind, apiKey)
 * pair. The one place that knows both concrete provider classes exist —
 * everything downstream (extraction, summarization, the chat screen)
 * only ever sees `LlmProvider`.
 */

import { ClaudeClient } from "../claude";
import { ClaudeProvider } from "./claudeProvider";
import { OpenRouterClient } from "./openrouter";
import type { LlmProvider } from "./types";

export type LlmProviderKind = "claude" | "openrouter";

/** Construction options for `buildLlmProvider`. */
export interface BuildLlmProviderOptions {
  kind: LlmProviderKind;
  apiKey: string;
  /** Overrides the provider's default model. */
  model?: string;
}

/** Construct the right `LlmProvider` for `kind`. */
export function buildLlmProvider(opts: BuildLlmProviderOptions): LlmProvider {
  if (opts.kind === "claude") {
    return new ClaudeProvider(
      new ClaudeClient({ apiKey: opts.apiKey, ...(opts.model !== undefined ? { defaultModel: opts.model } : {}) }),
    );
  }
  return new OpenRouterClient({
    apiKey: opts.apiKey,
    appTitle: "Kleep",
    ...(opts.model !== undefined ? { defaultModel: opts.model } : {}),
  });
}
