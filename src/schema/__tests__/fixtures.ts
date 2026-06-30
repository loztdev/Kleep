import {
  ConfidenceSource,
  ProvenanceSchema,
  RawQuoteAnchorSchema,
  TemporalRangeSchema,
  type Provenance,
  type RawQuoteAnchor,
  type TemporalRange,
} from "../index";

export const TURN_ID = "turn-0012";

export function makeAnchor(overrides: Partial<RawQuoteAnchor> = {}): RawQuoteAnchor {
  return RawQuoteAnchorSchema.parse({
    turn_id: TURN_ID,
    quote: "Mojo Jojo is a Pomeranian puppy.",
    char_start: 10,
    char_end: 42,
    ...overrides,
  });
}

export function makeTemporal(
  overrides: Partial<TemporalRange> = {},
): TemporalRange {
  return TemporalRangeSchema.parse({
    turn_start: TURN_ID,
    ...overrides,
  });
}

export function makeProvenance(
  overrides: Partial<Provenance> = {},
): Provenance {
  return ProvenanceSchema.parse({
    source_turn_id: TURN_ID,
    confidence_score: 0.9,
    confidence_source: ConfidenceSource.USER_ASSERTED,
    raw_quote_anchors: [makeAnchor()],
    temporal_range: makeTemporal(),
    ...overrides,
  });
}
