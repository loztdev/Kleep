/**
 * Tier 3.7 — Summarizer interface.
 *
 * Production summarizer calls an LLM with a "state delta" prompt; the
 * stub returns a deterministic string for tests. Either way, the
 * RollingSummarizer takes whatever comes back and wraps it in a
 * SUMMARY MemoryAsset with provenance anchored to the summarized turns.
 */

import type { Turn } from "../conversation";

export interface Summarizer {
  /**
   * Produce a compressed delta covering `turns`. Returns the raw delta
   * text; provenance and ingestion are the orchestrator's job.
   */
  summarize(turns: readonly Turn[]): Promise<string> | string;
}
