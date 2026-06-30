/**
 * Shared "what happened when an asset got ingested" types.
 *
 * Used by the AutoRetainEngine (Tier 2.4) and the DedupReconciler
 * (Tier 2.5). Lives in its own module so neither tier needs to depend
 * on the other.
 */

import type {
  LoreSnippet,
  MemoryAsset,
  WorldBibleEntry,
} from "../schema";

export type AnyAsset = MemoryAsset | WorldBibleEntry | LoreSnippet;

export type IngestOutcomeKind =
  | "created"        // new asset, written as-is
  | "bumped"         // exact duplicate; relevance incremented on existing
  | "merged"         // attributes folded into an existing entry
  | "state_changed"; // an attribute value changed (state delta)

export interface IngestOutcome {
  kind: IngestOutcomeKind;
  /** The asset as it now lives in storage. */
  asset: AnyAsset;
  /** Reconciler-specific notes (mutated keys, prior values, etc.). */
  details?: Record<string, unknown>;
}

export interface IngestSink {
  ingest(asset: AnyAsset): IngestOutcome;
}
