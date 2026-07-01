/**
 * Provider-agnostic cost ledger. Unlike `src/claude/costTracker.ts` (which
 * computes `costUsd` from a static per-model pricing table, since the
 * Anthropic API doesn't return one), this just accumulates entries the
 * caller has already priced — OpenRouter returns the actual USD cost per
 * call natively (`usage.cost`, opted into via `usage: { include: true }`),
 * so there's no pricing table to maintain here.
 */

/** One recorded call's token usage and cost. */
export interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Accumulates already-priced per-call entries into a history and running total. */
export class CostTracker {
  private readonly entries: CostEntry[] = [];

  /** Record one already-priced call and return it unchanged. */
  record(entry: CostEntry): CostEntry {
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
