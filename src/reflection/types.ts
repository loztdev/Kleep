/**
 * Tier 4.9 — CARA (Cognitive Async Reflection Architecture).
 *
 * Inputs and outputs for the offline reflection layer. The Reflector
 * interface is LLM-shaped (production calls Claude with a structured
 * prompt over the OPINION network); the StubReflector implements a
 * tiny deterministic heuristic so tests can exercise the pipeline.
 *
 * The engine consumes findings, emits REFLECTION MemoryAssets through
 * the IngestSink, and optionally applies side-effects (e.g., adjusting
 * the confidence of opinions that turned out to contradict a fact).
 */

import type {
  MemoryAsset,
  WorldBibleEntry,
} from "../schema";

export type ReflectionFindingKind =
  /** Two assets directly disagree. */
  | "contradiction"
  /** A fact or other opinion supports the primary opinion. */
  | "corroboration"
  /** The primary asset's basis no longer applies. */
  | "obsolescence"
  /** Multiple stale assets folded into one synthesis. */
  | "consolidation";

export type ReflectionEffect =
  /** Add (or subtract — sign matters) to the primary asset's confidence. */
  | { type: "adjust_confidence"; delta: number }
  /** Bump relevance — surfaces the asset in future recall. */
  | { type: "bump_relevance"; delta: number }
  /** Emit a REFLECTION asset only; don't touch the primary. */
  | { type: "note_only" };

export interface ReflectionFinding {
  kind: ReflectionFindingKind;
  /** The asset this finding is about. */
  primary_asset_id: string;
  /** Other assets that justify the finding (facts, opposing opinions). */
  supporting_asset_ids: readonly string[];
  /** Human-readable rationale — becomes the REFLECTION's content. */
  rationale: string;
  /** Reflector's confidence in the finding itself, 0..1. */
  confidence: number;
  effect: ReflectionEffect;
}

export interface ReflectionInput {
  opinions: readonly MemoryAsset[];
  facts: readonly MemoryAsset[];
  entries: readonly WorldBibleEntry[];
}

export interface Reflector {
  reflect(
    input: ReflectionInput,
  ): Promise<readonly ReflectionFinding[]> | readonly ReflectionFinding[];
}
