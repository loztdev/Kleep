/**
 * Tier 4.8 — Epistemic Traceability ("Why UI") data layer.
 *
 * A `ProvenanceBundle` is a flat, UI-friendly view of "why does the
 * system believe this?". The UI (RN, web, voice, whatever) doesn't
 * need to know about Zod schemas, the network taxonomy, or per-
 * attribute provenance — it just receives a bundle and renders it.
 *
 * Pure data — `explain.ts` builds these, no React anywhere.
 */

import type { ConfidenceSource, MemoryKind, Network } from "../schema";

export interface AnchorView {
  turn_id: string;
  /** Verbatim quote from the source turn. */
  quote: string;
  /** Char offsets if known (extractor-populated paths only). */
  char_start?: number;
  char_end?: number;
}

export interface TemporalView {
  turn_start: string;
  turn_end?: string;
  narrative_start?: string;
  narrative_end?: string;
  narrative_always: boolean;
}

export interface ConfidenceView {
  score: number;
  source: ConfidenceSource;
}

/**
 * The thing the Why UI renders. One bundle per "explain target":
 *   - an asset as a whole, OR
 *   - a single attribute on a World Bible entry, OR
 *   - a summary asset (which links back to N turns).
 */
export interface ProvenanceBundle {
  /** What this bundle is about. */
  subject: {
    asset_id: string;
    kind: MemoryKind;
    network: Network;
    /** Human-readable phrase the UI shows as the bundle title. */
    headline: string;
    /** For attribute bundles, the attribute key being explained. */
    attribute_key?: string;
    /** Value as JSON-ish for display. */
    attribute_value?: unknown;
  };
  confidence: ConfidenceView;
  temporal: TemporalView;
  /** Every anchor that justifies this claim, source-turn first. */
  anchors: AnchorView[];
  /** Optional viewpoint holder (set for OPINION-network bundles). */
  viewpoint_holder?: string;
  /**
   * Corroboration count = anchors.length. Surfaced separately because
   * the UI's "trust" affordance keys off it.
   */
  corroboration: number;
  /**
   * Tags attached to the underlying asset — the UI can use them for
   * badges (e.g. "rolling-summary").
   */
  tags: readonly string[];
}
