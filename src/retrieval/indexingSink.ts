/**
 * IndexingSink — wraps an inner IngestSink and mirrors every accepted
 * asset into a FusionRecallEngine's retrieval indexes after the inner
 * sink decides on the final shape.
 *
 * Wire it as the outermost sink:
 *
 *   const reconciler = new DedupReconciler(router)
 *   const fusion = new FusionRecallEngine({router, embedder})
 *   const sink = new IndexingSink(reconciler, fusion)
 *   const engine = new AutoRetainEngine(buffer, extractor, sink, ...)
 *
 * Re-indexing on every write is intentional — when the reconciler
 * bumps/merges/state-changes an asset, its content (especially for
 * entries) can change, and the BM25/entity indexes must reflect the
 * post-dedup state.
 */

import type { AnyAsset, IngestOutcome, IngestSink } from "../ingest";
import type { FusionRecallEngine } from "./fusionRecallEngine";

export class IndexingSink implements IngestSink {
  constructor(
    private readonly inner: IngestSink,
    private readonly fusion: FusionRecallEngine,
  ) {}

  ingest(asset: AnyAsset): IngestOutcome {
    const outcome = this.inner.ingest(asset);
    this.fusion.index(outcome.asset);
    return outcome;
  }
}
