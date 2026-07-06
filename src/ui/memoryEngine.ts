/**
 * Wires the Tier 1–3 memory pipeline (buffer → extraction → dedup → rolling
 * summary → retrieval indexes) behind a single `LlmProvider`.
 *
 * Stores and buffer are both injectable: on native, `App.tsx` opens the
 * shared on-device SQLite database once and passes `SqliteStructuredStore`/
 * `SqliteVectorStore` (one continuous memory across every chat session)
 * plus a `ConversationBuffer` hydrated from that session's persisted
 * turns; on web (no `expo-sqlite` support — see `openKleepDatabase.ts`)
 * or in tests, the defaults below give the exact fresh in-memory pipeline
 * this always was.
 *
 * The outer sink is an `IndexingSink` wrapping the `DedupReconciler`, so
 * every ingested asset (extraction output, rolling summaries, model tool
 * calls) is mirrored into the `FusionRecallEngine`'s BM25 / entity /
 * chronological indexes on write. Chat-side retrieval (see
 * `assembleMemoryContext`) reads from that engine.
 */

import { ConversationBuffer } from "../conversation";
import { StubEmbedder } from "../embedding";
import { AutoRetainEngine, LlmExtractor } from "../extraction";
import type { IngestSink } from "../ingest";
import type { LlmProvider } from "../llm";
import { DedupReconciler } from "../reconciler";
import { FusionRecallEngine, IndexingSink } from "../retrieval";
import { MemoryRouter } from "../router";
import { MemoryKind } from "../schema";
import {
  InMemoryStructuredStore,
  InMemoryVectorStore,
  type ChatSessionStore,
  type StructuredStore,
  type VectorStore,
} from "../storage";
import { LlmSummarizer, RollingSummarizer } from "../summarization";

/**
 * Live-token count at which `RollingSummarizer` rolls the oldest window
 * into a SUMMARY. Chosen high enough that a normal writing session's
 * context stays intact — earlier values (~800) fired every few turns and
 * dropped the summarized turns straight out of `liveTurns()`, which the
 * chat surface then sent to the model with no retrieval backfill, so
 * story context vanished. Retrieval now backfills whatever the
 * summarizer eats, but the threshold still sets when we start paying the
 * summarization cost, so this is the "your chat effectively has this
 * many tokens of *raw* recent context before compression kicks in" knob.
 */
const DEFAULT_SUMMARIZER_THRESHOLD = 16_384;

/** How many turns the summarizer rolls into one SUMMARY when it fires. */
const DEFAULT_SUMMARIZER_WINDOW = 6;

/** Everything the chat screen needs to turn conversation turns into remembered facts. */
export interface MemoryEngine {
  buffer: ConversationBuffer;
  structured: StructuredStore;
  vector: VectorStore;
  router: MemoryRouter;
  /** Outermost `IngestSink` — routes through the reconciler and mirrors into the retrieval indexes. */
  sink: IngestSink;
  autoRetain: AutoRetainEngine;
  rollingSummarizer: RollingSummarizer;
  /** Retrieval engine populated by `sink` and read by `assembleMemoryContext`. */
  fusion: FusionRecallEngine;
}

export interface BuildMemoryEngineOptions {
  structured?: StructuredStore;
  vector?: VectorStore;
  buffer?: ConversationBuffer;
}

/** Build the memory pipeline backed by `provider`, over the given (or fresh in-memory) stores/buffer. */
export function buildMemoryEngine(
  provider: LlmProvider,
  opts: BuildMemoryEngineOptions = {},
): MemoryEngine {
  const buffer = opts.buffer ?? new ConversationBuffer();
  const structured = opts.structured ?? new InMemoryStructuredStore();
  const vector = opts.vector ?? new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  const embedder = new StubEmbedder();
  const fusion = new FusionRecallEngine({ router, embedder });

  // Every accepted asset flows through the reconciler (dedup) first, then
  // gets mirrored into the retrieval indexes. Order matters — the fusion
  // engine wants the post-dedup shape, not the raw input.
  const reconciler = new DedupReconciler(router);
  const sink: IngestSink = new IndexingSink(reconciler, fusion);

  // Persisted stores (SQLite on native) already have assets on disk from
  // prior sessions. The retrieval indexes are in-memory, so on load we
  // walk everything and reindex — otherwise recall returns nothing until
  // the current session writes something new, silently blinding the
  // model to a whole prior conversation's history. Both stores need a
  // pass: MemoryAssets + WorldBibleEntries live in `structured`, but
  // LoreSnippets live in `vector` and would otherwise never regain
  // BM25/entity/chronological coverage after a restart.
  for (const asset of structured.query({})) fusion.index(asset);
  for (const snippet of vector.list()) fusion.index(snippet);

  const extractor = new LlmExtractor({ client: provider });
  const autoRetain = new AutoRetainEngine(buffer, extractor, sink, {
    embedder,
    // A model hallucinating one bad quote shouldn't take down the whole
    // turn's extraction — drop that fact, keep the rest.
    onAnchorMiss: "skip",
  });

  const summarizer = new LlmSummarizer({ client: provider });
  const rollingSummarizer = new RollingSummarizer(buffer, summarizer, sink, {
    threshold: DEFAULT_SUMMARIZER_THRESHOLD,
    windowSize: DEFAULT_SUMMARIZER_WINDOW,
  });

  return { buffer, structured, vector, router, sink, autoRetain, rollingSummarizer, fusion };
}

// Re-export MemoryKind so callers wiring the engine don't need a second import.
export { MemoryKind };

/**
 * Mirror a buffer's processed/summarized progress into its persisted
 * session after a tick. Re-syncs the full summarized set rather than
 * threading turn-id deltas out of `AutoRetainEngine`/`RollingSummarizer`
 * — simpler, and `ChatSessionStore.markSummarized`/`updateProcessedCount`
 * are both idempotent, so resyncing already-persisted state is harmless.
 */
export function syncSessionProgress(
  store: ChatSessionStore,
  sessionId: string,
  buffer: ConversationBuffer,
): void {
  store.updateProcessedCount(sessionId, buffer.processedCount());
  const summarizedIds = buffer.all().filter((t) => buffer.isSummarized(t.id)).map((t) => t.id);
  if (summarizedIds.length) store.markSummarized(sessionId, summarizedIds);
}
