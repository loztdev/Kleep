import {
  ConfidenceSource,
  MemoryKind,
  Network,
  ProvenanceSchema,
  RawQuoteAnchorSchema,
  TemporalRangeSchema,
  WorldBibleAttributeSchema,
  WorldBibleEntrySchema,
  newId,
  type MemoryAsset,
  type Provenance,
  type WorldBibleAttribute,
  type WorldBibleEntry,
} from "../../schema";
import {
  InMemoryStructuredStore,
  InMemoryVectorStore,
} from "../../storage";
import { MemoryRouter } from "../../router";
import { DedupReconciler } from "../dedupReconciler";
import {
  makeFact,
  makeOpinion,
} from "../../storage/__tests__/fixtures";

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

function entry(
  entityId: string,
  turnId: string,
  attrs: WorldBibleAttribute[],
  opts: { aliases?: string[]; confidence?: number } = {},
): WorldBibleEntry {
  return WorldBibleEntrySchema.parse({
    id: newId(),
    network: Network.WORLD,
    content: `${entityId} card`,
    provenance: prov(turnId, opts.confidence ?? 0.8),
    entity_id: entityId,
    entity_type: "character",
    canonical_name: entityId,
    aliases: opts.aliases ?? [],
    attributes: attrs,
  });
}

function harness() {
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  return {
    structured,
    vector,
    router,
    reconciler: new DedupReconciler(router),
  };
}

describe("DedupReconciler — entries (Tier 2.5)", () => {
  it("first ingest is 'created'", () => {
    const h = harness();
    const e = entry("char:mojo", "t1", [attr("species", "dog", "t1")]);
    const out = h.reconciler.ingest(e);
    expect(out.kind).toBe("created");
    expect(h.structured.getEntry("char:mojo")?.id).toBe(e.id);
  });

  it("identical re-ingest is 'bumped' (corroboration only)", () => {
    const h = harness();
    h.reconciler.ingest(entry("char:mojo", "t1", [attr("species", "dog", "t1")]));
    const out = h.reconciler.ingest(
      entry("char:mojo", "t2", [attr("species", "dog", "t2")]),
    );
    expect(out.kind).toBe("bumped");
    const stored = h.structured.getEntry("char:mojo")!;
    expect(stored.relevance).toBe(1);
    expect(stored.attributes[0]!.provenance.raw_quote_anchors.length).toBe(2);
  });

  it("new attribute key is 'merged'", () => {
    const h = harness();
    h.reconciler.ingest(entry("char:mojo", "t1", [attr("species", "dog", "t1")]));
    const out = h.reconciler.ingest(
      entry("char:mojo", "t2", [attr("color", "brown", "t2")]),
    );
    expect(out.kind).toBe("merged");
    const stored = h.structured.getEntry("char:mojo")!;
    expect(stored.attributes.map((a) => a.key).sort()).toEqual([
      "color",
      "species",
    ]);
  });

  it("differing value with higher confidence flips to 'state_changed'", () => {
    const h = harness();
    h.reconciler.ingest(
      entry("char:mojo", "t1", [attr("species", "dog", "t1", 0.5)]),
    );
    const out = h.reconciler.ingest(
      entry("char:mojo", "t2", [attr("species", "wolf", "t2", 0.9)]),
    );
    expect(out.kind).toBe("state_changed");
    const stored = h.structured.getEntry("char:mojo")!;
    expect(stored.attributes.find((a) => a.key === "species")!.value).toBe(
      "wolf",
    );
  });

  it("differing value with lower confidence keeps existing", () => {
    const h = harness();
    h.reconciler.ingest(
      entry("char:mojo", "t1", [attr("species", "dog", "t1", 0.9)]),
    );
    h.reconciler.ingest(
      entry("char:mojo", "t2", [attr("species", "wolf", "t2", 0.3)]),
    );
    const stored = h.structured.getEntry("char:mojo")!;
    expect(stored.attributes.find((a) => a.key === "species")!.value).toBe(
      "dog",
    );
  });

  it("aliases union, never duplicated", () => {
    const h = harness();
    h.reconciler.ingest(
      entry("char:mojo", "t1", [], { aliases: ["Mojo"] }),
    );
    const out = h.reconciler.ingest(
      entry("char:mojo", "t2", [], { aliases: ["Mojo", "Mo"] }),
    );
    expect(out.kind).toBe("merged");
    const stored = h.structured.getEntry("char:mojo")!;
    expect([...stored.aliases].sort()).toEqual(["Mo", "Mojo"]);
  });

  it("bumps entry-level relevance every time", () => {
    const h = harness();
    const e = entry("char:mojo", "t1", [attr("species", "dog", "t1")]);
    h.reconciler.ingest(e);
    h.reconciler.ingest(
      entry("char:mojo", "t2", [attr("species", "dog", "t2")]),
    );
    h.reconciler.ingest(
      entry("char:mojo", "t3", [attr("species", "dog", "t3")]),
    );
    expect(h.structured.getEntry("char:mojo")!.relevance).toBe(2);
  });
});

describe("DedupReconciler — atomic facts", () => {
  it("first ingest is 'created'", () => {
    const h = harness();
    const f = makeFact({ content: "They met at the docks." });
    const out = h.reconciler.ingest(f);
    expect(out.kind).toBe("created");
    expect(h.structured.size()).toBe(1);
  });

  it("identical content is bumped, not duplicated", () => {
    const h = harness();
    h.reconciler.ingest(makeFact({ content: "They met at the docks." }));
    const out = h.reconciler.ingest(
      makeFact({ content: "They met at the docks." }),
    );
    expect(out.kind).toBe("bumped");
    expect(h.structured.size()).toBe(1);
    const bumped = out.asset as MemoryAsset;
    expect(bumped.relevance).toBe(1);
  });

  it("content equality is normalized (whitespace, case)", () => {
    const h = harness();
    h.reconciler.ingest(makeFact({ content: "They met at the docks." }));
    const out = h.reconciler.ingest(
      makeFact({ content: "they met   at  THE docks." }),
    );
    expect(out.kind).toBe("bumped");
  });

  it("different content yields a separate asset", () => {
    const h = harness();
    h.reconciler.ingest(makeFact({ content: "They met at the docks." }));
    h.reconciler.ingest(makeFact({ content: "They fought at the docks." }));
    expect(h.structured.size()).toBe(2);
  });

  it("different viewpoint_holder doesn't dedup opinions", () => {
    const h = harness();
    h.reconciler.ingest(
      makeOpinion("alice", { content: "The king is weak." }),
    );
    const out = h.reconciler.ingest(
      makeOpinion("bob", { content: "The king is weak." }),
    );
    expect(out.kind).toBe("created");
    expect(h.structured.size()).toBe(2);
  });

  it("same viewpoint_holder + same opinion is bumped", () => {
    const h = harness();
    h.reconciler.ingest(
      makeOpinion("alice", { content: "The king is weak." }),
    );
    const out = h.reconciler.ingest(
      makeOpinion("alice", { content: "The king is weak." }),
    );
    expect(out.kind).toBe("bumped");
    expect(h.structured.size()).toBe(1);
  });

  it("bump preserves first-witness source_turn_id", () => {
    const h = harness();
    const first = makeFact({
      content: "They met.",
      provenance: prov("turn-first", 0.7, "They met."),
    });
    h.reconciler.ingest(first);
    const second = makeFact({
      content: "They met.",
      provenance: prov("turn-later", 0.7, "They met."),
    });
    const out = h.reconciler.ingest(second);
    expect((out.asset as MemoryAsset).provenance.source_turn_id).toBe(
      "turn-first",
    );
    expect((out.asset as MemoryAsset).last_updated_turn).toBe("turn-later");
  });
});

describe("DedupReconciler — lore", () => {
  // Lore dedup is a Tier 4.9 (CARA) concern; reconciler just writes through.
  it("creates lore without dedup", () => {
    // The router will reject a LoreSnippet without an embedding; we don't
    // exercise lore here — TheTier 2 integration tests do, with the embedder.
    // This stub-test reserves the kind=LORE branch.
    expect(MemoryKind.LORE).toBe("lore");
  });
});
