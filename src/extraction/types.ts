/**
 * Tier 2.4: extraction interfaces.
 *
 * The Extractor's job is "given a turn, what facts does it contain and
 * exactly where in the text are they?". It deliberately knows nothing
 * about provenance bundling, networks, or storage — the AutoRetainEngine
 * wraps each ExtractedFact with full Provenance before handing off to
 * the reconciler.
 *
 * Two extracted shapes:
 *
 * - `ExtractedAtomicFact` — produces a MemoryAsset (FACT / RULE /
 *   OPINION / SUMMARY / REFLECTION).
 * - `ExtractedEntity` — produces a WorldBibleEntry, optionally with
 *   per-attribute extractions that each carry their own quote.
 *
 * `quote` MUST be a verbatim substring of the source turn's content.
 * The engine re-verifies this to guard against LLM-style hallucination.
 */

import type { MemoryKind, Network } from "../schema";
import type { Turn } from "../conversation";

/** A non-entity claim extracted from a turn: FACT / RULE / OPINION / SUMMARY / REFLECTION / LORE. */
export interface ExtractedAtomicFact {
  type: "atomic";
  kind: MemoryKind;
  network: Network;
  content: string;
  /** Verbatim substring of the source turn that justifies this fact. */
  quote: string;
  /** Extractor's self-reported confidence in [0, 1]. */
  confidence: number;
  entity_ids?: readonly string[];
  viewpoint_holder?: string;
  tags?: readonly string[];
}

/** One typed claim about an entity, with its own quote anchor and confidence. */
export interface ExtractedAttribute {
  key: string;
  value: unknown;
  quote: string;
  confidence: number;
}

/** An entity card extracted from a turn — becomes a WorldBibleEntry. */
export interface ExtractedEntity {
  type: "entity";
  entity_id: string;
  entity_type: string;
  canonical_name: string;
  network: Network;
  content: string;
  /** Verbatim substring of the source turn that justifies this entity. */
  quote: string;
  confidence: number;
  attributes?: readonly ExtractedAttribute[];
  aliases?: readonly string[];
  summary?: string;
}

/** Discriminated union of every shape an extractor may emit. */
export type ExtractedFact = ExtractedAtomicFact | ExtractedEntity;

/** Pluggable extraction interface — `PatternExtractor` (stub) or `LlmExtractor` (any `LlmProvider`). */
export interface Extractor {
  /**
   * Extract facts from a single turn. May return synchronously (stub
   * extractors) or asynchronously (LLM-backed extractors).
   */
  extract(turn: Turn): Promise<readonly ExtractedFact[]> | readonly ExtractedFact[];
}
