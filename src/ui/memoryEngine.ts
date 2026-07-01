/**
 * Wires the Tier 1–3 memory pipeline (buffer → extraction → dedup → rolling
 * summary) behind a single `LlmProvider`. In-memory stores only — no
 * persistence yet (Tier 6), so the world bible/lore book reset on reload.
 * That's expected for this first usable pass, not a bug.
 */

import { ConversationBuffer } from "../conversation";
import { StubEmbedder } from "../embedding";
import { AutoRetainEngine, LlmExtractor } from "../extraction";
import type { LlmProvider } from "../llm";
import { DedupReconciler } from "../reconciler";
import { MemoryRouter } from "../router";
import { InMemoryStructuredStore, InMemoryVectorStore } from "../storage";
import { LlmSummarizer, RollingSummarizer } from "../summarization";

/** Everything the chat screen needs to turn conversation turns into remembered facts. */
export interface MemoryEngine {
  buffer: ConversationBuffer;
  structured: InMemoryStructuredStore;
  vector: InMemoryVectorStore;
  router: MemoryRouter;
  autoRetain: AutoRetainEngine;
  rollingSummarizer: RollingSummarizer;
}

/** Build a fresh in-memory pipeline backed by `provider`. */
export function buildMemoryEngine(provider: LlmProvider): MemoryEngine {
  const buffer = new ConversationBuffer();
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
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
