import { MemoryKind, Network } from "../../schema";
import {
  ConversationBuffer,
  TurnRole,
  type Turn,
} from "../../conversation";
import {
  InMemoryStructuredStore,
  InMemoryVectorStore,
} from "../../storage";
import { MemoryRouter } from "../../router";
import { RouterSink } from "../../ingest";
import { StubEmbedder } from "../../embedding";
import type {
  ExtractedFact,
  Extractor,
} from "../types";
import {
  AutoRetainEngine,
  ExtractionAnchorError,
  MissingEmbedderError,
} from "../autoRetainEngine";
import { PatternExtractor } from "../patternExtractor";

function turn(content: string, id = "t1", index = 0): Turn {
  return { id, role: TurnRole.USER, content, index };
}

function harness(
  extractor: Extractor,
  opts: { embedder?: StubEmbedder; onAnchorMiss?: "throw" | "skip" } = {},
) {
  const buffer = new ConversationBuffer();
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  const sink = new RouterSink(router);
  return {
    buffer,
    structured,
    vector,
    router,
    engine: new AutoRetainEngine(buffer, extractor, sink, opts),
  };
}

describe("AutoRetainEngine — happy path", () => {
  it("processes a turn, anchors facts, writes through the sink", async () => {
    const h = harness(new PatternExtractor());
    h.buffer.append(turn("Mojo is a puppy. Mojo is at Park."));
    const res = await h.engine.tick();

    expect(res.turnsProcessed).toBe(1);
    expect(res.outcomes.length).toBeGreaterThan(0);
    expect(h.structured.size()).toBeGreaterThan(0);

    // Every stored asset must carry a provenance whose anchor turn
    // matches the source turn.
    for (const o of res.outcomes) {
      expect(o.asset.provenance.source_turn_id).toBe("t1");
      const anchor = o.asset.provenance.raw_quote_anchors[0]!;
      expect(anchor.turn_id).toBe("t1");
      expect(anchor.char_start).toBeGreaterThanOrEqual(0);
      expect(anchor.char_end).toBeGreaterThan(anchor.char_start!);
    }
  });

  it("advances the buffer high-water mark past processed turns", async () => {
    const h = harness(new PatternExtractor());
    h.buffer.append(turn("Mojo is a puppy.", "t1", 0));
    h.buffer.append(turn("Alice is at Park.", "t2", 1));
    await h.engine.tick();
    expect(h.buffer.processedCount()).toBe(2);
    expect(h.buffer.pendingTurns()).toEqual([]);
  });

  it("routes a LORE-kind fact through the embedder into the vector store", async () => {
    const embedder = new StubEmbedder();
    const h = harness(loreEmittingExtractor(), { embedder });
    h.buffer.append(turn("anything"));
    const res = await h.engine.tick();
    expect(h.vector.size()).toBe(1);
    expect(h.structured.size()).toBe(0);
    const stored = h.vector.get(res.outcomes[0]!.asset.id);
    expect(stored?.embedding?.length).toBe(embedder.dim);
    expect(stored?.embedding_model).toBe(embedder.model);
  });

  it("throws MissingEmbedderError if LORE comes through without an embedder", async () => {
    const h = harness(loreEmittingExtractor());
    h.buffer.append(turn("anything"));
    await expect(h.engine.tick()).rejects.toBeInstanceOf(
      MissingEmbedderError,
    );
  });
});

describe("AutoRetainEngine — anti-hallucination", () => {
  it("throws when an extracted quote isn't in the turn (default)", async () => {
    const h = harness(hallucinatingExtractor());
    h.buffer.append(turn("Mojo is a puppy."));
    await expect(h.engine.tick()).rejects.toBeInstanceOf(
      ExtractionAnchorError,
    );
  });

  it("skips bad facts and keeps good ones when onAnchorMiss='skip'", async () => {
    const buffer = new ConversationBuffer();
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    const sink = new RouterSink(router);
    const engine = new AutoRetainEngine(
      buffer,
      mixedExtractor(),
      sink,
      { onAnchorMiss: "skip" },
    );

    buffer.append(turn("Mojo is a puppy."));
    const res = await engine.tick();
    expect(res.outcomes).toHaveLength(1); // hallucinated one skipped
    expect(structured.size()).toBe(1);
  });
});

describe("AutoRetainEngine — provenance correctness", () => {
  it("attribute provenance also anchors to the source turn", async () => {
    const h = harness(new PatternExtractor());
    h.buffer.append(turn("Mojo is a puppy."));
    await h.engine.tick();

    const entry = h.structured.getEntry("char:mojo");
    expect(entry).toBeDefined();
    expect(entry!.attributes.length).toBeGreaterThan(0);
    for (const attr of entry!.attributes) {
      expect(attr.provenance.source_turn_id).toBe("t1");
      const anc = attr.provenance.raw_quote_anchors[0]!;
      expect(anc.turn_id).toBe("t1");
    }
  });
});

// ---- helpers ---------------------------------------------------------

function loreEmittingExtractor(): Extractor {
  return {
    extract(t): readonly ExtractedFact[] {
      const quote = t.content;
      return [
        {
          type: "atomic",
          kind: MemoryKind.LORE,
          network: Network.WORLD,
          content: "lore line",
          quote,
          confidence: 0.5,
        },
      ];
    },
  };
}

function hallucinatingExtractor(): Extractor {
  return {
    extract(): readonly ExtractedFact[] {
      return [
        {
          type: "atomic",
          kind: MemoryKind.FACT,
          network: Network.OBSERVATION,
          content: "never said this",
          quote: "this string is not in the turn",
          confidence: 0.9,
        },
      ];
    },
  };
}

function mixedExtractor(): Extractor {
  return {
    extract(t): readonly ExtractedFact[] {
      return [
        {
          type: "atomic",
          kind: MemoryKind.FACT,
          network: Network.OBSERVATION,
          content: "bad",
          quote: "definitely not present",
          confidence: 0.9,
        },
        {
          type: "atomic",
          kind: MemoryKind.FACT,
          network: Network.OBSERVATION,
          content: "good",
          quote: t.content.slice(0, 4), // verifiable substring
          confidence: 0.9,
        },
      ];
    },
  };
}
