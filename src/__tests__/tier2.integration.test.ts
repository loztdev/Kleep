/**
 * Tier 2 end-to-end integration.
 *
 * A conversation streams in turn-by-turn. The full pipeline runs:
 *
 *   buffer  → AutoRetainEngine → DedupReconciler → MemoryRouter →
 *     structured + vector stores
 *
 * Asserts: facts get persisted with correct provenance, duplicates bump
 * relevance instead of duplicating, entity attribute changes are
 * detected as state changes, embeddings flow through for LORE, and the
 * buffer's high-water mark advances.
 */

import {
  AutoRetainEngine,
  ConversationBuffer,
  DedupReconciler,
  InMemoryStructuredStore,
  InMemoryVectorStore,
  MemoryKind,
  MemoryRouter,
  Network,
  PatternExtractor,
  StubEmbedder,
  TurnRole,
  type ExtractedFact,
  type Extractor,
  type Turn,
  type WorldBibleEntry,
} from "../index";

function turn(id: string, content: string, index = 0): Turn {
  return { id, role: TurnRole.USER, content, index };
}

function pipeline(extractor: Extractor = new PatternExtractor()) {
  const buffer = new ConversationBuffer();
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  const reconciler = new DedupReconciler(router);
  const embedder = new StubEmbedder();
  const engine = new AutoRetainEngine(buffer, extractor, reconciler, {
    embedder,
  });
  return { buffer, structured, vector, router, reconciler, engine };
}

describe("Tier 2 integration", () => {
  it("a single turn populates the World Bible with anchored provenance", async () => {
    const p = pipeline();
    p.buffer.append(turn("t1", "Mojo is a puppy."));
    await p.engine.tick();

    const entry = p.structured.getEntry("char:mojo");
    expect(entry).toBeDefined();
    expect(entry!.provenance.source_turn_id).toBe("t1");
    expect(entry!.attributes[0]!.provenance.raw_quote_anchors[0]!.turn_id).toBe(
      "t1",
    );
  });

  it("two turns asserting the same fact bump relevance instead of duplicating", async () => {
    const p = pipeline();
    p.buffer.append(turn("t1", "Mojo is at Park.", 0));
    p.buffer.append(turn("t2", "Mojo is at Park.", 1));
    await p.engine.tick();

    const stored = p.structured.query({
      kind: MemoryKind.FACT,
      network: Network.EXPERIENCE,
    });
    expect(stored).toHaveLength(1);
    expect((stored[0] as { relevance: number }).relevance).toBe(1);
    // The bumped asset accumulates both anchors.
    expect(stored[0]!.provenance.raw_quote_anchors).toHaveLength(2);
  });

  it("attribute state change is detected as state_changed", async () => {
    const p = pipeline(stateFlipExtractor());
    p.buffer.append(turn("t1", "first."));
    p.buffer.append(turn("t2", "second."));
    const r1 = await p.engine.tick();
    expect(r1.outcomes[0]!.kind).toBe("created");
    expect(r1.outcomes[1]!.kind).toBe("state_changed");

    const entry = p.structured.getEntry("char:mojo") as WorldBibleEntry;
    expect(entry.attributes[0]!.value).toBe("wolf");
  });

  it("opinion facts route to OPINION network and stay isolated by viewpoint_holder", async () => {
    const p = pipeline();
    p.buffer.append(turn("t1", "Alice thinks the king is weak."));
    p.buffer.append(turn("t2", "Bob thinks the king is weak."));
    await p.engine.tick();

    const alice = p.router.query({
      network: Network.OPINION,
      viewpoint_holder: "Alice",
    });
    const bob = p.router.query({
      network: Network.OPINION,
      viewpoint_holder: "Bob",
    });
    expect(alice).toHaveLength(1);
    expect(bob).toHaveLength(1);
    // Cross-leak check: querying Alice's view doesn't include Bob's.
    expect(alice[0]!.viewpoint_holder).toBe("Alice");
  });

  it("LORE flows through the embedder and is semantically retrievable", async () => {
    const p = pipeline(loreExtractor());
    p.buffer.append(turn("t1", "the desert hums at noon"));
    p.buffer.append(turn("t2", "the night brings cold"));
    await p.engine.tick();

    const hits = p.router.semanticQuery(
      new StubEmbedder().embed("the desert hums at noon") as number[],
      5,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.snippet.content).toContain("desert");
  });

  it("buffer high-water mark advances past processed turns", async () => {
    const p = pipeline();
    p.buffer.append(turn("t1", "Mojo is a puppy.", 0));
    p.buffer.append(turn("t2", "Alice is at Park.", 1));
    await p.engine.tick();
    expect(p.buffer.processedCount()).toBe(2);
    expect(p.buffer.pendingTurns()).toEqual([]);

    p.buffer.append(turn("t3", "Mojo has a red collar.", 2));
    expect(p.buffer.pendingTurns().map((t) => t.id)).toEqual(["t3"]);
  });
});

// ---- helpers ---------------------------------------------------------

function stateFlipExtractor(): Extractor {
  // Emits the same entity twice, with the second asserting a different
  // species value at higher confidence to trigger state_changed.
  let call = 0;
  return {
    extract(t): readonly ExtractedFact[] {
      call += 1;
      const isFirst = call === 1;
      return [
        {
          type: "entity",
          entity_id: "char:mojo",
          entity_type: "character",
          canonical_name: "Mojo",
          network: Network.OBSERVATION,
          content: t.content,
          quote: t.content,
          confidence: isFirst ? 0.5 : 0.9,
          attributes: [
            {
              key: "species",
              value: isFirst ? "dog" : "wolf",
              quote: t.content,
              confidence: isFirst ? 0.5 : 0.9,
            },
          ],
        },
      ];
    },
  };
}

function loreExtractor(): Extractor {
  return {
    extract(t): readonly ExtractedFact[] {
      return [
        {
          type: "atomic",
          kind: MemoryKind.LORE,
          network: Network.WORLD,
          content: t.content,
          quote: t.content,
          confidence: 0.6,
        },
      ];
    },
  };
}
