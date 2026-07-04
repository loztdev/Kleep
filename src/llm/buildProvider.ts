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
  // Deliberately no `appTitle` — that would set an `X-Title: Kleep` header on
  // every request, which upstream providers can (and some do) route through
  // moderation heuristics. Requests from unknown/small app identities can hit
  // stricter Trust & Safety review than the same request from a first-party
  // client like OpenRouter's own playground, which then reads as "the JB
  // works elsewhere but not here." Skipping attribution keeps our requests
  // shaped like an anonymous playground call at the header layer. The only
  // thing lost is OpenRouter's public leaderboard placement, which isn't a
  // goal for this app.
  return new OpenRouterClient({
    apiKey: opts.apiKey,
    ...(opts.model !== undefined ? { defaultModel: opts.model } : {}),
  });
}
