/**
 * Cheap token estimator — chars / 4, the standard OpenAI/Anthropic
 * rule of thumb. Override via the `estimate` arg to plug in a real
 * tokenizer (e.g. `gpt-tokenizer`) without touching call sites.
 *
 * Used by Tier 3.6 (FusionRecallEngine — budgeted result selection)
 * and Tier 3.7 (RollingSummarizer — threshold trigger).
 */

/** Pluggable token-count function used by token-budget code paths. */
export type TokenEstimator = (text: string) => number;

/** Default `TokenEstimator` — `Math.ceil(text.length / 4)`. */
export const estimateTokensByChars: TokenEstimator = (text) =>
  Math.ceil(text.length / 4);
