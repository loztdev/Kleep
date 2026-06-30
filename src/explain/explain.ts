/**
 * Build a UI-ready ProvenanceBundle from any memory asset.
 *
 * The Why UI does NOT introspect the Zod schema — these helpers do the
 * translation once, in one place. Callers pass the asset (and optionally
 * which attribute, for entry attribute bundles) and get back a flat
 * object the UI can render directly.
 */

import {
  MemoryKind,
  type LoreSnippet,
  type MemoryAsset,
  type Provenance,
  type WorldBibleAttribute,
  type WorldBibleEntry,
} from "../schema";
import type { AnyAsset } from "../ingest";
import type {
  AnchorView,
  ProvenanceBundle,
  ConfidenceView,
  TemporalView,
} from "./types";

/**
 * Builds a provenance bundle for an asset.
 *
 * @returns The asset-level provenance bundle.
 */
export function explain(asset: AnyAsset): ProvenanceBundle {
  return {
    subject: {
      asset_id: asset.id,
      kind: asset.kind,
      network: asset.network,
      headline: headlineFor(asset),
    },
    confidence: confidenceView(asset.provenance),
    temporal: temporalView(asset.provenance),
    anchors: anchorsFor(asset.provenance),
    viewpoint_holder: asset.viewpoint_holder,
    corroboration: asset.provenance.raw_quote_anchors.length,
    tags: asset.tags,
  };
}

/**
 * Builds a provenance bundle for a single attribute on a world bible entry.
 *
 * @param entry - The entry containing the attribute
 * @param attributeKey - The attribute key to locate
 * @returns A provenance bundle for the matching attribute
 * @throws Error if the attribute is not found on the entry
 */
export function explainAttribute(
  entry: WorldBibleEntry,
  attributeKey: string,
): ProvenanceBundle {
  const attr = entry.attributes.find((a) => a.key === attributeKey);
  if (!attr) {
    throw new Error(
      `attribute ${JSON.stringify(attributeKey)} not found on entry ${entry.entity_id}`,
    );
  }
  return {
    subject: {
      asset_id: entry.id,
      kind: MemoryKind.ENTITY,
      network: entry.network,
      headline: `${entry.canonical_name}: ${attr.key} = ${stringify(attr.value)}`,
      attribute_key: attr.key,
      attribute_value: attr.value,
    },
    confidence: confidenceView(attr.provenance),
    temporal: temporalView(attr.provenance),
    anchors: anchorsFor(attr.provenance),
    viewpoint_holder: entry.viewpoint_holder,
    corroboration: attr.provenance.raw_quote_anchors.length,
    tags: entry.tags,
  };
}

/**
 * Builds provenance bundles for every attribute on an entry.
 *
 * @param entry - The entry whose attributes are explained
 * @returns A bundle for each attribute on `entry`
 */
export function explainAllAttributes(
  entry: WorldBibleEntry,
): ProvenanceBundle[] {
  return entry.attributes.map((a) => explainAttribute(entry, a.key));
}

/**
 * Narrows an asset to a world bible entry.
 *
 * @param asset - The asset to check
 * @returns `true` if the asset is a world bible entry, `false` otherwise.
 */

function isWorldBibleEntry(asset: AnyAsset): asset is WorldBibleEntry {
  return (
    asset.kind === MemoryKind.ENTITY &&
    (asset as WorldBibleEntry).entity_id !== undefined
  );
}

/**
 * Builds a display headline for an asset.
 *
 * @returns A headline based on the asset's kind and available text.
 */
function headlineFor(asset: AnyAsset): string {
  if (isWorldBibleEntry(asset)) {
    return `${asset.canonical_name} — ${asset.entity_type}`;
  }
  if (asset.kind === MemoryKind.LORE) {
    const lore = asset as LoreSnippet;
    return lore.title ?? trunc(lore.content, 80);
  }
  return trunc((asset as MemoryAsset).content, 80);
}

/**
 * Builds a confidence view from provenance data.
 *
 * @param p - The provenance record to read from
 * @returns The confidence score and source
 */
function confidenceView(p: Provenance): ConfidenceView {
  return { score: p.confidence_score, source: p.confidence_source };
}

/**
 * Maps provenance temporal data into a view model.
 *
 * @returns The turn and narrative time range fields from the provenance.
 */
function temporalView(p: Provenance): TemporalView {
  return {
    turn_start: p.temporal_range.turn_start,
    turn_end: p.temporal_range.turn_end,
    narrative_start: p.temporal_range.narrative_start,
    narrative_end: p.temporal_range.narrative_end,
    narrative_always: p.temporal_range.narrative_always,
  };
}

/**
 * Builds anchor views sorted by source turn and turn order.
 *
 * @returns The quote anchors mapped to `AnchorView` objects, with the source turn first and the remaining anchors ordered by ascending `turn_id`.
 */
function anchorsFor(p: Provenance): AnchorView[] {
  // Source turn first — it's the "first witness" and the UI shows it
  // most prominently.
  const sourceId = p.source_turn_id;
  const sorted = [...p.raw_quote_anchors].sort((a, b) => {
    if (a.turn_id === sourceId) return -1;
    if (b.turn_id === sourceId) return 1;
    return a.turn_id < b.turn_id ? -1 : a.turn_id > b.turn_id ? 1 : 0;
  });
  return sorted.map((a) => ({
    turn_id: a.turn_id,
    quote: a.quote,
    char_start: a.char_start,
    char_end: a.char_end,
  }));
}

/**
 * Truncates a string to a maximum length.
 *
 * @param s - The string to truncate
 * @param n - The maximum length
 * @returns The original string when its length is within the limit, or a shortened string ending with an ellipsis
 */
function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * Converts a value into a displayable string.
 *
 * @param v - The value to convert
 * @returns The string representation of `v`, or `—` when the value cannot be represented
 */
function stringify(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "—";
  }
}

/**
 * Exposes selected internal helpers for inspection.
 *
 * @returns An object containing `isWorldBibleEntry` and `headlineFor`.
 */
export function _internals() {
  return { isWorldBibleEntry, headlineFor };
}
