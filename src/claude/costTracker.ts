/**
 * Tier 5.5 — token + cost accounting, exposed for the settings dashboard
 * (Tier 7.3) to render a running spend total.
 *
 * Pricing is per-million-tokens, USD, standard tier. Snapshot taken
 * 2026-06-24 — see the `claude-api` skill's model table for the live
 * source. Unknown models record token counts with `costUsd: 0` rather
 * than throwing, so a new model id doesn't break extraction/summarization.
 */

import type Anthropic from "@anthropic-ai/sdk";

/** Per-million-token input/output pricing for one model. */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Snapshot pricing for current-generation models. Override via `CostTracker`'s constructor for custom/negotiated rates. */
export const DEFAULT_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-mythos-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

/** One recorded call's token usage and computed cost. */
export interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
}

/** Accumulates per-call token usage into a cost history and running total. */
export class CostTracker {
  private readonly entries: CostEntry[] = [];

  /** @param pricing  Per-model rate table. Defaults to `DEFAULT_PRICING`. */
  constructor(private readonly pricing: Readonly<Record<string, ModelPricing>> = DEFAULT_PRICING) {}

  /** Record one API call's usage and return the computed `CostEntry`. */
  record(model: string, usage: Anthropic.Usage): CostEntry {
    const price = this.pricing[model];
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const costUsd = price
      ? (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000
      : 0;
    const entry: CostEntry = {
      model,
      inputTokens,
      outputTokens,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      costUsd,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Every recorded entry, oldest first. */
  history(): readonly CostEntry[] {
    return this.entries;
  }

  /** Sum of `costUsd` across every recorded entry. */
  totalUsd(): number {
    return this.entries.reduce((sum, entry) => sum + entry.costUsd, 0);
  }
}
