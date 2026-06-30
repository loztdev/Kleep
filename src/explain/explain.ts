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

/** Build a bundle for an asset as a whole. */
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

/** Build a bundle narrowed to a single attribute on a WorldBibleEntry. */
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
 * Convenience: build bundles for every attribute on an entry.
 * Useful for an "expand all" view on the entity card.
 */
export function explainAllAttributes(
  entry: WorldBibleEntry,
): ProvenanceBundle[] {
  return entry.attributes.map((a) => explainAttribute(entry, a.key));
}

// ---- internals ---------------------------------------------------------

function isWorldBibleEntry(asset: AnyAsset): asset is WorldBibleEntry {
  return (
    asset.kind === MemoryKind.ENTITY &&
    (asset as WorldBibleEntry).entity_id !== undefined
  );
}

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

function confidenceView(p: Provenance): ConfidenceView {
  return { score: p.confidence_score, source: p.confidence_source };
}

function temporalView(p: Provenance): TemporalView {
  return {
    turn_start: p.temporal_range.turn_start,
    turn_end: p.temporal_range.turn_end,
    narrative_start: p.temporal_range.narrative_start,
    narrative_end: p.temporal_range.narrative_end,
    narrative_always: p.temporal_range.narrative_always,
  };
}

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

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

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

export function _internals() {
  return { isWorldBibleEntry, headlineFor };
}
