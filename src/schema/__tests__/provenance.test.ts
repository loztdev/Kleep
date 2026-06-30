import {
  ConfidenceSource,
  ProvenanceSchema,
  RawQuoteAnchorSchema,
  TemporalRangeSchema,
} from "../index";
import { TURN_ID, makeAnchor, makeProvenance, makeTemporal } from "./fixtures";

describe("RawQuoteAnchor", () => {
  it("accepts minimum fields", () => {
    const a = RawQuoteAnchorSchema.parse({ turn_id: TURN_ID, quote: "x" });
    expect(a.turn_id).toBe(TURN_ID);
    expect(a.char_start).toBeUndefined();
    expect(a.char_end).toBeUndefined();
  });

  it("rejects empty quote", () => {
    expect(() =>
      RawQuoteAnchorSchema.parse({ turn_id: TURN_ID, quote: "" }),
    ).toThrow();
  });

  it("rejects partial span (start without end)", () => {
    expect(() =>
      RawQuoteAnchorSchema.parse({
        turn_id: TURN_ID,
        quote: "x",
        char_start: 0,
      }),
    ).toThrow();
  });

  it("rejects inverted span", () => {
    expect(() =>
      RawQuoteAnchorSchema.parse({
        turn_id: TURN_ID,
        quote: "x",
        char_start: 10,
        char_end: 5,
      }),
    ).toThrow();
  });

  it("rejects extra fields (strict mode)", () => {
    expect(() =>
      RawQuoteAnchorSchema.parse({
        turn_id: TURN_ID,
        quote: "x",
        surprise: "boo",
      }),
    ).toThrow();
  });
});

describe("TemporalRange", () => {
  it("defaults turn_end to undefined (still in effect)", () => {
    const t = TemporalRangeSchema.parse({ turn_start: TURN_ID });
    expect(t.turn_end).toBeUndefined();
    expect(t.narrative_always).toBe(false);
  });

  it("accepts narrative_always", () => {
    const t = TemporalRangeSchema.parse({
      turn_start: TURN_ID,
      narrative_always: true,
    });
    expect(t.narrative_always).toBe(true);
  });

  it("narrative_always blocks narrative bounds", () => {
    expect(() =>
      TemporalRangeSchema.parse({
        turn_start: TURN_ID,
        narrative_always: true,
        narrative_start: "dawn",
      }),
    ).toThrow();
  });

  it("rejects missing turn_start", () => {
    expect(() => TemporalRangeSchema.parse({})).toThrow();
  });
});

describe("Provenance", () => {
  it("happy path round-trips", () => {
    const p = makeProvenance();
    expect(p.source_turn_id).toBe(TURN_ID);
    expect(p.confidence_score).toBe(0.9);
    expect(p.confidence_source).toBe(ConfidenceSource.USER_ASSERTED);
    expect(p.raw_quote_anchors).toHaveLength(1);
  });

  it.each([-0.01, 1.01, 2.0, -1.0])(
    "rejects confidence_score=%p as out of bounds",
    (score) => {
      expect(() =>
        ProvenanceSchema.parse({
          source_turn_id: TURN_ID,
          confidence_score: score,
          raw_quote_anchors: [makeAnchor()],
          temporal_range: makeTemporal(),
        }),
      ).toThrow();
    },
  );

  it("rejects empty raw_quote_anchors", () => {
    expect(() =>
      ProvenanceSchema.parse({
        source_turn_id: TURN_ID,
        confidence_score: 0.5,
        raw_quote_anchors: [],
        temporal_range: makeTemporal(),
      }),
    ).toThrow();
  });

  it("rejects anchors that don't reference source_turn_id", () => {
    const bad = makeAnchor({ turn_id: "some-other-turn" });
    expect(() =>
      ProvenanceSchema.parse({
        source_turn_id: TURN_ID,
        confidence_score: 0.5,
        raw_quote_anchors: [bad],
        temporal_range: makeTemporal(),
      }),
    ).toThrow();
  });

  it("defaults confidence_source to INFERRED", () => {
    const p = ProvenanceSchema.parse({
      source_turn_id: TURN_ID,
      confidence_score: 0.5,
      raw_quote_anchors: [makeAnchor()],
      temporal_range: makeTemporal(),
    });
    expect(p.confidence_source).toBe(ConfidenceSource.INFERRED);
  });

  it("survives a JSON round-trip", () => {
    const p = makeProvenance();
    const restored = ProvenanceSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(restored).toEqual(p);
  });
});
