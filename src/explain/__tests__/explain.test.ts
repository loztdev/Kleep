import {
  ConfidenceSource,
  MemoryKind,
  Network,
  WorldBibleAttributeSchema,
  WorldBibleEntrySchema,
  newId,
} from "../../schema";
import {
  makeAnchor,
  makeProvenance,
  TURN_ID,
} from "../../schema/__tests__/fixtures";
import {
  makeFact,
  makeLore,
  makeOpinion,
} from "../../storage/__tests__/fixtures";
import {
  explain,
  explainAllAttributes,
  explainAttribute,
} from "../explain";
import { StubEmbedder } from "../../embedding";

describe("explain — atomic asset", () => {
  it("returns a bundle for a FACT", () => {
    const fact = makeFact({ content: "Mojo is at Park." });
    const b = explain(fact);
    expect(b.subject.asset_id).toBe(fact.id);
    expect(b.subject.kind).toBe(MemoryKind.FACT);
    expect(b.subject.network).toBe(Network.EXPERIENCE);
    expect(b.subject.headline).toContain("Mojo is at Park");
    expect(b.confidence.score).toBe(0.9);
    expect(b.confidence.source).toBe(ConfidenceSource.USER_ASSERTED);
    expect(b.corroboration).toBe(1);
    expect(b.anchors[0]!.turn_id).toBe(TURN_ID);
    expect(b.viewpoint_holder).toBeUndefined();
  });

  it("returns a bundle for an OPINION with viewpoint_holder", () => {
    const op = makeOpinion("alice", { content: "The king is weak." });
    const b = explain(op);
    expect(b.subject.network).toBe(Network.OPINION);
    expect(b.viewpoint_holder).toBe("alice");
  });

  it("returns a bundle for a LORE snippet", () => {
    const embedder = new StubEmbedder();
    const lore = makeLore([...(embedder.embed("test") as number[])]);
    const b = explain(lore);
    expect(b.subject.kind).toBe(MemoryKind.LORE);
    expect(b.subject.headline.length).toBeGreaterThan(0);
  });

  it("uses LoreSnippet.title in the headline when present", () => {
    const embedder = new StubEmbedder();
    const { LoreSnippetSchema } = require("../../schema");
    const lore = LoreSnippetSchema.parse({
      id: newId(),
      network: Network.WORLD,
      content: "a very long body that should be truncated...",
      provenance: makeProvenance(),
      title: "The Desert",
      embedding: [...(embedder.embed("x") as number[])],
      embedding_model: embedder.model,
    });
    const b = explain(lore);
    expect(b.subject.headline).toBe("The Desert");
  });

  it("truncates long content for the headline", () => {
    const long = "a".repeat(200);
    const fact = makeFact({ content: long });
    const b = explain(fact);
    expect(b.subject.headline.length).toBeLessThanOrEqual(80);
    expect(b.subject.headline.endsWith("…")).toBe(true);
  });

  it("source-turn anchor is always first in the list", () => {
    const sourceAnchor = makeAnchor({
      turn_id: TURN_ID,
      quote: "primary",
      char_start: undefined,
      char_end: undefined,
    });
    const olderAnchor = makeAnchor({
      turn_id: "turn-0001",
      quote: "older corroboration",
      char_start: undefined,
      char_end: undefined,
    });
    const newerAnchor = makeAnchor({
      turn_id: "turn-9999",
      quote: "newer corroboration",
      char_start: undefined,
      char_end: undefined,
    });
    const fact = makeFact({
      provenance: makeProvenance({
        raw_quote_anchors: [olderAnchor, newerAnchor, sourceAnchor],
      }),
    });
    const b = explain(fact);
    expect(b.anchors[0]!.turn_id).toBe(TURN_ID);
  });
});

describe("explainAttribute — entry attribute bundle", () => {
  function entryWithAttr() {
    const attrProv = makeProvenance({
      confidence_score: 0.6,
      confidence_source: ConfidenceSource.INFERRED,
    });
    const attr = WorldBibleAttributeSchema.parse({
      key: "species",
      value: "Pomeranian",
      provenance: attrProv,
    });
    return WorldBibleEntrySchema.parse({
      id: newId(),
      network: Network.WORLD,
      content: "Mojo card",
      provenance: makeProvenance(),
      entity_id: "char:mojo",
      entity_type: "character",
      canonical_name: "Mojo",
      attributes: [attr],
    });
  }

  it("returns a bundle scoped to one attribute", () => {
    const entry = entryWithAttr();
    const b = explainAttribute(entry, "species");
    expect(b.subject.attribute_key).toBe("species");
    expect(b.subject.attribute_value).toBe("Pomeranian");
    expect(b.subject.headline).toBe("Mojo: species = Pomeranian");
    expect(b.confidence.score).toBe(0.6); // attribute provenance, not entry
  });

  it("throws on unknown attribute key", () => {
    const entry = entryWithAttr();
    expect(() => explainAttribute(entry, "missing")).toThrow(/missing/);
  });
});

describe("explainAllAttributes", () => {
  it("returns one bundle per attribute", () => {
    const p = makeProvenance();
    const attrs = ["species", "color"].map((k, i) =>
      WorldBibleAttributeSchema.parse({
        key: k,
        value: i === 0 ? "Pomeranian" : "brown",
        provenance: p,
      }),
    );
    const entry = WorldBibleEntrySchema.parse({
      id: newId(),
      network: Network.WORLD,
      content: "x",
      provenance: p,
      entity_id: "char:mojo",
      entity_type: "character",
      canonical_name: "Mojo",
      attributes: attrs,
    });
    const all = explainAllAttributes(entry);
    expect(all).toHaveLength(2);
    expect(all.map((b) => b.subject.attribute_key).sort()).toEqual([
      "color",
      "species",
    ]);
  });
});
