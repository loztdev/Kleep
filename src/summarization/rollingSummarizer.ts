/**
 * Tier 3.7 — Rolling State-Delta Summarizer.
 *
 * Watches the live-token count of the ConversationBuffer. When it
 * crosses `threshold`, the oldest `windowSize` non-summarized turns are
 * handed to a Summarizer; the result is wrapped in a SUMMARY
 * MemoryAsset whose provenance pins one anchor per summarized turn and
 * whose temporal_range spans first→last turn id. The summary is
 * ingested through the same IngestSink as everything else (so the
 * reconciler and indexes see it like any other asset). Finally the
 * summarized turns are marked, freeing their raw text from the
 * live-token count for next time.
 *
 * The summarizer is deliberately stateless beyond the buffer it
 * watches — restart-safe by construction.
 */

import { ConversationBuffer, type Turn } from "../conversation";
import {
  ConfidenceSource,
  MemoryAssetSchema,
  MemoryKind,
  Network,
  ProvenanceSchema,
  RawQuoteAnchorSchema,
  TemporalRangeSchema,
  newId,
  type MemoryAsset,
} from "../schema";
import type { IngestOutcome, IngestSink } from "../ingest";
import {
  estimateTokensByChars,
  type TokenEstimator,
} from "../retrieval/tokenBudget";
import type { Summarizer } from "./types";

/** Construction options for `RollingSummarizer`. */
export interface RollingSummarizerOptions {
  /** Trigger summarization when live tokens >= this many. */
  threshold: number;
  /** How many turns to roll into one SUMMARY when triggered. */
  windowSize: number;
  /** Token estimator — defaults to chars/4. */
  estimateTokens?: TokenEstimator;
  /**
   * Network the produced SUMMARY assets land in. Defaults to
   * EXPERIENCE — summaries describe what happened.
   */
  summaryNetwork?: Network;
  /**
   * Maximum quote length per anchor. Anchors must be verbatim
   * substrings of the source turn; we take the head of each turn.
   */
  anchorChars?: number;
}

/** Summary returned from one `RollingSummarizer.tick()` or `flush()` call. */
export interface SummarizationTickResult {
  summariesProduced: number;
  outcomes: IngestOutcome[];
}

/** Tier 3.7 — rolls old buffer turns into SUMMARY assets when token threshold is crossed. */
export class RollingSummarizer {
  private readonly threshold: number;
  private readonly windowSize: number;
  private readonly estimateTokens: TokenEstimator;
  private readonly summaryNetwork: Network;
  private readonly anchorChars: number;

  constructor(
    private readonly buffer: ConversationBuffer,
    private readonly summarizer: Summarizer,
    private readonly sink: IngestSink,
    opts: RollingSummarizerOptions,
  ) {
    if (opts.windowSize <= 0) throw new Error("windowSize must be > 0");
    if (opts.threshold <= 0) throw new Error("threshold must be > 0");
    const anchorChars = opts.anchorChars ?? 64;
    if (anchorChars <= 0) throw new Error("anchorChars must be > 0");
    this.threshold = opts.threshold;
    this.windowSize = opts.windowSize;
    this.estimateTokens = opts.estimateTokens ?? estimateTokensByChars;
    this.summaryNetwork = opts.summaryNetwork ?? Network.EXPERIENCE;
    this.anchorChars = anchorChars;
  }

  /**
   * Repeatedly summarize the oldest live window while live tokens
   * exceed the configured threshold. Each pass consumes `windowSize`
   * turns and emits one SUMMARY asset.
   */
  async tick(): Promise<SummarizationTickResult> {
    const outcomes: IngestOutcome[] = [];
    let summariesProduced = 0;

    while (
      this.buffer.liveTokenCount(this.estimateTokens) >= this.threshold
    ) {
      const window = this.nextWindow();
      if (window.length === 0) break;
      const outcome = await this.summarizeWindow(window);
      outcomes.push(outcome);
      summariesProduced += 1;
    }

    return { summariesProduced, outcomes };
  }

  /**
   * Summarize the oldest live window unconditionally. Useful at
   * conversation boundaries or shutdown — runs one pass even if the
   * threshold isn't met.
   */
  async flush(): Promise<SummarizationTickResult> {
    const window = this.nextWindow();
    if (window.length === 0) {
      return { summariesProduced: 0, outcomes: [] };
    }
    const outcome = await this.summarizeWindow(window);
    return { summariesProduced: 1, outcomes: [outcome] };
  }

  // ---- internals -------------------------------------------------------

  /** The oldest `windowSize` live (non-summarized) turns, or fewer if the buffer is short. */
  private nextWindow(): Turn[] {
    const live = this.buffer.liveTurns();
    return live.slice(0, Math.min(this.windowSize, live.length));
  }

  /** Call the summarizer, ingest the produced SUMMARY, and mark the window summarized. */
  private async summarizeWindow(window: Turn[]): Promise<IngestOutcome> {
    const delta = await Promise.resolve(this.summarizer.summarize(window));
    const asset = this.buildSummaryAsset(window, delta);
    const outcome = this.sink.ingest(asset);
    this.buffer.markSummarized(window.map((t) => t.id));
    return outcome;
  }

  /** Wrap a delta string in a fully-formed SUMMARY MemoryAsset with per-turn anchors. */
  private buildSummaryAsset(window: Turn[], delta: string): MemoryAsset {
    const first = window[0]!;
    const last = window[window.length - 1]!;
    const anchors = window.map((t) =>
      RawQuoteAnchorSchema.parse({
        turn_id: t.id,
        quote: anchorFor(t.content, this.anchorChars),
      }),
    );
    const provenance = ProvenanceSchema.parse({
      // Pin source to the *last* turn — it's when the summary becomes
      // true. The validator just needs one anchor to match.
      source_turn_id: last.id,
      confidence_score: 0.95,
      confidence_source: ConfidenceSource.DERIVED,
      raw_quote_anchors: anchors,
      temporal_range: TemporalRangeSchema.parse({
        turn_start: first.id,
        turn_end: last.id,
      }),
    });
    return MemoryAssetSchema.parse({
      id: newId(),
      network: this.summaryNetwork,
      kind: MemoryKind.SUMMARY,
      content: delta,
      provenance,
      tags: ["rolling-summary"],
    });
  }
}

/** Take the head of `content` up to `max` chars; never returns empty for non-empty input. */
function anchorFor(content: string, max: number): string {
  if (content.length === 0) return content;
  if (content.length <= max) return content;
  return content.slice(0, max);
}
