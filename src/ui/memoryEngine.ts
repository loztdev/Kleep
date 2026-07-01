/**
 * Wires the Tier 1–3 memory pipeline (buffer → extraction → dedup → rolling
 * summary) behind a single `LlmProvider`.
 *
 * Stores and buffer are both injectable: on native, `App.tsx` opens the
 * shared on-device SQLite database once and passes `SqliteStructuredStore`/
 * `SqliteVectorStore` (one continuous memory across every chat session)
 * plus a `ConversationBuffer` hydrated from that session's persisted
 * turns; on web (no `expo-sqlite` support — see `openKleepDatabase.ts`)
 * or in tests, the defaults below give the exact fresh in-memory pipeline
 * this always was.
 */

import { ConversationBuffer } from "../conversation";
import { StubEmbedder } from "../embedding";
import { AutoRetainEngine, LlmExtractor } from "../extraction";
import type { LlmProvider } from "../llm";
import { DedupReconciler } from "../reconciler";
import { MemoryRouter } from "../router";
import {
  InMemoryStructuredStore,
  InMemoryVectorStore,
  type ChatSessionStore,
  type StructuredStore,
  type VectorStore,
} from "../storage";
import { LlmSummarizer, RollingSummarizer } from "../summarization";

/** Everything the chat screen needs to turn conversation turns into remembered facts. */
export interface MemoryEngine {
  buffer: ConversationBuffer;
  structured: StructuredStore;
  vector: VectorStore;
  router: MemoryRouter;
  autoRetain: AutoRetainEngine;
  rollingSummarizer: RollingSummarizer;
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
  const sink = new DedupReconciler(router);

  const extractor = new LlmExtractor({ client: provider });
  const autoRetain = new AutoRetainEngine(buffer, extractor, sink, {
    embedder: new StubEmbedder(),
    // A model hallucinating one bad quote shouldn't take down the whole
    // turn's extraction — drop that fact, keep the rest.
    onAnchorMiss: "skip",
  });

  const summarizer = new LlmSummarizer({ client: provider });
  const rollingSummarizer = new RollingSummarizer(buffer, summarizer, sink, {
    threshold: 800,
    windowSize: 6,
  });

  return { buffer, structured, vector, router, autoRetain, rollingSummarizer };
}

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
