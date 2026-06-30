/**
 * Per-attribute merge logic for the DedupReconciler (Tier 2.5).
 *
 * When the same World Bible attribute (say `species`) arrives a second
 * time, we don't blindly overwrite — we compare confidence, then
 * temporal recency, then accumulate the new quote as corroborating
 * evidence. The merge is pure: no mutation, no side effects.
 *
 * Pulled into its own module so the rules are auditable in isolation
 * and so the reconciler stays focused on dispatch.
 */

import {
  WorldBibleAttributeSchema,
  type Provenance,
  type RawQuoteAnchor,
  type WorldBibleAttribute,
} from "../schema";

/** What happened to an attribute during reconciliation. */
export type AttributeMergeKind =
  | "added"          // attribute didn't exist before
  | "corroborated"   // same value arrived again → relevance/anchor bumped
  | "state_changed"  // value replaced (higher confidence or newer)
  | "ignored";       // value differs but incoming loses on confidence/recency

/** Outcome bundle returned from `mergeAttribute`. */
export interface AttributeMergeResult {
  kind: AttributeMergeKind;
  attribute: WorldBibleAttribute;
  previousValue?: unknown;
}

/**
 * Decide what happens when `incoming` arrives and an existing attribute
 * may already be present. Pure — returns the merge result; doesn't write.
 */
export function mergeAttribute(
  existing: WorldBibleAttribute | undefined,
  incoming: WorldBibleAttribute,
): AttributeMergeResult {
  if (!existing) return { kind: "added", attribute: incoming };

  if (sameValue(existing.value, incoming.value)) {
    return {
      kind: "corroborated",
      attribute: WorldBibleAttributeSchema.parse({
        key: existing.key,
        value: existing.value,
        provenance: combineProvenance(existing.provenance, incoming.provenance),
      }),
    };
  }

  const winner = pickWinner(existing.provenance, incoming.provenance);
  if (winner === "incoming") {
    return {
      kind: "state_changed",
      attribute: incoming,
      previousValue: existing.value,
    };
  }
  return {
    kind: "ignored",
    attribute: existing,
    previousValue: incoming.value,
  };
}

/**
 * Higher confidence wins; on a tie, the later turn wins; on a true tie,
 * the existing value stays (stability).
 *
 * Turn ids are opaque strings, so "later" is determined by lexicographic
 * compare — fine for monotonic counters like `turn-0012`. If callers
 * want strict ordering they can prefix-zero-pad.
 */
function pickWinner(
  existing: Provenance,
  incoming: Provenance,
): "existing" | "incoming" {
  if (incoming.confidence_score > existing.confidence_score) return "incoming";
  if (incoming.confidence_score < existing.confidence_score) return "existing";
  if (incoming.temporal_range.turn_start > existing.temporal_range.turn_start) {
    return "incoming";
  }
  return "existing";
}

/**
 * Folds incoming corroborating evidence into existing provenance:
 *   - confidence rises to the higher of the two
 *   - raw_quote_anchors gains the new anchor(s), de-duplicated by (turn_id, quote)
 *   - source_turn_id and temporal_range remain pinned to the original
 *     (first-witness rule)
 */
export function combineProvenance(
  existing: Provenance,
  incoming: Provenance,
): Provenance {
  const seen = new Set(
    existing.raw_quote_anchors.map((a) => anchorKey(a)),
  );
  const extras: RawQuoteAnchor[] = [];
  for (const a of incoming.raw_quote_anchors) {
    const k = anchorKey(a);
    if (!seen.has(k)) {
      seen.add(k);
      extras.push(a);
    }
  }
  return {
    ...existing,
    confidence_score: Math.max(
      existing.confidence_score,
      incoming.confidence_score,
    ),
    raw_quote_anchors: [...existing.raw_quote_anchors, ...extras],
  };
}

/** Stable hash key for an anchor used during anchor de-duplication. */
function anchorKey(a: RawQuoteAnchor): string {
  return `${a.turn_id}::${a.quote}`;
}

/** Value-equality for attribute values, with JSON fallback for objects. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  // Treat objects structurally — JSON-stable forms compare cheaply
  // and the schema only stores JSON-shaped attribute values anyway.
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
