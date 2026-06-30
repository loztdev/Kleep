import {
  LoreSnippetSchema,
  MemoryAssetSchema,
  MemoryKind,
  Network,
  WorldBibleAttributeSchema,
  WorldBibleEntrySchema,
  getAttribute,
  withRelevance,
} from "../index";
import { makeProvenance } from "./fixtures";

describe("MemoryAsset", () => {
  it("constructs with provenance", () => {
    const p = makeProvenance();
    const a = MemoryAssetSchema.parse({
      network: Network.EXPERIENCE,
      kind: MemoryKind.FACT,
      content: "They met at the docks.",
      provenance: p,
    });
    expect(a.id).toBeTruthy();
    expect(a.provenance).toEqual(p);
    expect(a.relevance).toBe(0);
    expect(a.entity_ids).toEqual([]);
  });

  it("rejects missing provenance", () => {
    expect(() =>
      MemoryAssetSchema.parse({
        network: Network.EXPERIENCE,
        kind: MemoryKind.FACT,
        content: "x",
      }),
    ).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      MemoryAssetSchema.parse({
        network: Network.EXPERIENCE,
        kind: MemoryKind.FACT,
        content: "x",
        provenance: makeProvenance(),
        surprise: "boo",
      }),
    ).toThrow();
  });

  it("withRelevance returns a new copy and never mutates", () => {
    const a = MemoryAssetSchema.parse({
      network: Network.EXPERIENCE,
      kind: MemoryKind.FACT,
      content: "x",
      provenance: makeProvenance(),
    });
    const b = withRelevance(a, 3);
    expect(a.relevance).toBe(0);
    expect(b.relevance).toBe(3);
    expect(b.id).toBe(a.id);
  });

  it("withRelevance floors at zero", () => {
    const a = MemoryAssetSchema.parse({
      network: Network.EXPERIENCE,
      kind: MemoryKind.FACT,
      content: "x",
      provenance: makeProvenance(),
    });
    expect(withRelevance(a, -5).relevance).toBe(0);
  });
});

describe("WorldBibleEntry", () => {
  it("happy path", () => {
    const p = makeProvenance();
    const attr = WorldBibleAttributeSchema.parse({
      key: "species",
      value: "Pomeranian",
      provenance: p,
    });
    const e = WorldBibleEntrySchema.parse({
      network: Network.WORLD,
      content: "Mojo Jojo — Pomeranian puppy.",
      provenance: p,
      entity_id: "char:mojo",
      entity_type: "character",
      canonical_name: "Mojo Jojo",
      aliases: ["Mojo"],
      attributes: [attr],
    });
    expect(e.kind).toBe(MemoryKind.ENTITY);
    expect(getAttribute(e, "species")).toEqual(attr);
    expect(getAttribute(e, "missing")).toBeUndefined();
  });

  it.each([Network.EXPERIENCE, Network.OPINION])(
    "rejects %s network",
    (network) => {
      expect(() =>
        WorldBibleEntrySchema.parse({
          network,
          content: "x",
          provenance: makeProvenance(),
          entity_id: "e",
          entity_type: "character",
          canonical_name: "X",
        }),
      ).toThrow();
    },
  );

  it("attributes survive a JSON round-trip", () => {
    const p = makeProvenance();
    const attr = WorldBibleAttributeSchema.parse({
      key: "hp",
      value: 42,
      provenance: p,
    });
    const e = WorldBibleEntrySchema.parse({
      network: Network.OBSERVATION,
      content: "x",
      provenance: p,
      entity_id: "e1",
      entity_type: "character",
      canonical_name: "X",
      attributes: [attr],
    });
    const restored = WorldBibleEntrySchema.parse(
      JSON.parse(JSON.stringify(e)),
    );
    expect(restored).toEqual(e);
    expect(restored.attributes[0].value).toBe(42);
  });
});

describe("LoreSnippet", () => {
  it("defaults kind to LORE", () => {
    const s = LoreSnippetSchema.parse({
      network: Network.WORLD,
      content: "The desert hums at noon.",
      provenance: makeProvenance(),
    });
    expect(s.kind).toBe(MemoryKind.LORE);
    expect(s.embedding).toBeUndefined();
    expect(s.embedding_model).toBeUndefined();
  });

  it("embedding round-trips losslessly", () => {
    const s = LoreSnippetSchema.parse({
      network: Network.WORLD,
      content: "x",
      provenance: makeProvenance(),
      embedding: [0.1, 0.2, 0.3],
      embedding_model: "stub-v1",
    });
    const restored = LoreSnippetSchema.parse(JSON.parse(JSON.stringify(s)));
    expect(restored.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(restored.embedding_model).toBe("stub-v1");
  });
});
