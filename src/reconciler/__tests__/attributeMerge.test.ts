import {
  ConfidenceSource,
  ProvenanceSchema,
  RawQuoteAnchorSchema,
  TemporalRangeSchema,
  WorldBibleAttributeSchema,
  type Provenance,
  type WorldBibleAttribute,
} from "../../schema";
import { combineProvenance, mergeAttribute } from "../attributeMerge";

function prov(
  turnId: string,
  confidence: number,
  quote = "x",
): Provenance {
  return ProvenanceSchema.parse({
    source_turn_id: turnId,
    confidence_score: confidence,
    confidence_source: ConfidenceSource.INFERRED,
    raw_quote_anchors: [
      RawQuoteAnchorSchema.parse({ turn_id: turnId, quote }),
    ],
    temporal_range: TemporalRangeSchema.parse({ turn_start: turnId }),
  });
}

function attr(
  key: string,
  value: unknown,
  turnId: string,
  confidence = 0.7,
): WorldBibleAttribute {
  return WorldBibleAttributeSchema.parse({
    key,
    value,
    provenance: prov(turnId, confidence),
  });
}

describe("mergeAttribute", () => {
  it("returns 'added' when no existing attribute", () => {
    const result = mergeAttribute(undefined, attr("species", "dog", "t1"));
    expect(result.kind).toBe("added");
    expect(result.attribute.value).toBe("dog");
  });

  it("returns 'corroborated' when values match", () => {
    const a = attr("species", "dog", "t1", 0.7);
    const b = attr("species", "dog", "t2", 0.6);
    const result = mergeAttribute(a, b);
    expect(result.kind).toBe("corroborated");
    // Anchors should accumulate.
    expect(result.attribute.provenance.raw_quote_anchors.length).toBe(2);
    // Confidence rises to the max.
    expect(result.attribute.provenance.confidence_score).toBe(0.7);
    // source_turn_id stays pinned to the first witness.
    expect(result.attribute.provenance.source_turn_id).toBe("t1");
  });

  it("returns 'state_changed' when incoming has higher confidence", () => {
    const a = attr("species", "dog", "t1", 0.5);
    const b = attr("species", "wolf", "t2", 0.9);
    const result = mergeAttribute(a, b);
    expect(result.kind).toBe("state_changed");
    expect(result.attribute.value).toBe("wolf");
    expect(result.previousValue).toBe("dog");
  });

  it("returns 'ignored' when incoming has lower confidence", () => {
    const a = attr("species", "dog", "t1", 0.9);
    const b = attr("species", "wolf", "t2", 0.3);
    const result = mergeAttribute(a, b);
    expect(result.kind).toBe("ignored");
    expect(result.attribute.value).toBe("dog");
    expect(result.previousValue).toBe("wolf");
  });

  it("on equal confidence, later turn wins", () => {
    const a = attr("species", "dog", "t01", 0.7);
    const b = attr("species", "wolf", "t02", 0.7);
    const result = mergeAttribute(a, b);
    expect(result.kind).toBe("state_changed");
    expect(result.attribute.value).toBe("wolf");
  });

  it("on equal confidence and same turn ordering, existing wins (stability)", () => {
    const a = attr("species", "dog", "t02", 0.7);
    const b = attr("species", "wolf", "t01", 0.7);
    const result = mergeAttribute(a, b);
    expect(result.kind).toBe("ignored");
    expect(result.attribute.value).toBe("dog");
  });

  it("handles object values via JSON equality", () => {
    const a = attr("stats", { hp: 10, str: 5 }, "t1");
    const b = attr("stats", { hp: 10, str: 5 }, "t2");
    expect(mergeAttribute(a, b).kind).toBe("corroborated");
  });
});

describe("combineProvenance", () => {
  it("de-duplicates anchors by (turn_id, quote)", () => {
    const a = prov("t1", 0.5, "X is a Y.");
    const b = prov("t1", 0.5, "X is a Y."); // identical anchor
    const merged = combineProvenance(a, b);
    expect(merged.raw_quote_anchors.length).toBe(1);
  });

  it("appends distinct anchors", () => {
    const a = prov("t1", 0.5, "X is a Y.");
    const b = prov("t2", 0.5, "X is a Z.");
    const merged = combineProvenance(a, b);
    expect(merged.raw_quote_anchors.length).toBe(2);
  });

  it("raises confidence to the max", () => {
    const merged = combineProvenance(prov("t1", 0.4), prov("t2", 0.9));
    expect(merged.confidence_score).toBe(0.9);
  });
});
