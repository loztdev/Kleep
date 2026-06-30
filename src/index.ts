/**
 * Kleep — aggregate automatic memory system.
 *
 * Tier 1 surface:
 *   - `./schema`        — provenance-first data schema (Tier 1.1)
 *   - `./storage`       — dual-engine storage (Tier 1.2)
 *   - `./router`        — 4-network isolation + dispatch (Tier 1.3)
 *
 * Tier 2 surface:
 *   - `./conversation`  — Turn + ConversationBuffer
 *   - `./extraction`    — Extractor interface, PatternExtractor, AutoRetainEngine (Tier 2.4)
 *   - `./embedding`     — Embedder interface, StubEmbedder
 *   - `./ingest`        — IngestSink + RouterSink adapter
 *   - `./reconciler`    — DedupReconciler + attribute merge (Tier 2.5)
 *
 * Tier 3 surface:
 *   - `./retrieval`     — FusionRecallEngine (BM25 + vector + entity + chronological) (Tier 3.6)
 *   - `./summarization` — RollingSummarizer + StubSummarizer (Tier 3.7)
 */

export * from "./schema";
export * from "./storage";
export * from "./router";
export * from "./conversation";
export * from "./extraction";
export * from "./embedding";
export * from "./ingest";
export * from "./reconciler";
export * from "./retrieval";
export * from "./summarization";
