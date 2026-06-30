/**
 * Tier 4.10 — skepticism gate in AutoRetainEngine.
 *
 * Exercises the engine's interaction with the disposition matrix end-
 * to-end: low-confidence facts get held until corroborated, high
 * confidence flows through immediately, neutral skepticism is a no-op.
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
  RouterSink,
  TurnRole,
  type Extractor,
  type ExtractedFact,
  type Turn,
} from "../../index";

function turn(id: string, content: string, idx = 0): Turn {
  return { id, role: TurnRole.USER, content, index: idx };
}

function harness(
  extractor: Extractor,
  disposition?: { skepticism?: number; literalism?: number },
) {
  const buffer = new ConversationBuffer();
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  void new DedupReconciler(router);
  const sink = new RouterSink(router);
  return {
    buffer,
    structured,
    router,
    engine: new AutoRetainEngine(buffer, extractor, sink, { disposition }),
  };
}

function lowConfidenceFact(content: string, confidence = 0.2): Extractor {
  return {
    extract(t): readonly ExtractedFact[] {
      return [
        {
          type: "atomic",
          kind: MemoryKind.FACT,
          network: Network.OBSERVATION,
          content,
          quote: t.content,
          confidence,
        },
      ];
    },
  };
}

describe("AutoRetainEngine — skepticism gate", () => {
  it("neutral skepticism (default): low-confidence fact persists immediately", async () => {
    const h = harness(lowConfidenceFact("x"));
    h.buffer.append(turn("t1", "anything", 0));
    const res = await h.engine.tick();
    expect(res.outcomes).toHaveLength(1);
    expect(h.structured.size()).toBe(1);
  });

  it("full skepticism: 0.2-confidence fact does NOT persist on first mention", async () => {
    const h = harness(lowConfidenceFact("x", 0.2), { skepticism: 1 });
    h.buffer.append(turn("t1", "anything", 0));
    const res = await h.engine.tick();
    expect(res.outcomes).toHaveLength(0);
    expect(h.structured.size()).toBe(0);
  });

  it("full skepticism: 0.2-confidence fact persists after 4 mentions", async () => {
    const h = harness(lowConfidenceFact("x", 0.2), { skepticism: 1 });
    for (let i = 0; i < 4; i++) {
      h.buffer.append(turn(`t${i}`, "anything", i));
    }
    const res = await h.engine.tick();
    // The 4th mention triggers acceptance.
    expect(res.outcomes).toHaveLength(1);
    expect(h.structured.size()).toBe(1);
  });

  it("full skepticism: 0.7-confidence fact (above floor) persists immediately", async () => {
    const h = harness(lowConfidenceFact("x", 0.7), { skepticism: 1 });
    h.buffer.append(turn("t1", "anything", 0));
    const res = await h.engine.tick();
    expect(res.outcomes).toHaveLength(1);
  });

  it("half skepticism: 0.1-confidence fact persists after 2 mentions", async () => {
    const h = harness(lowConfidenceFact("x", 0.1), { skepticism: 0.5 });
    h.buffer.append(turn("t1", "anything", 0));
    h.buffer.append(turn("t2", "anything", 1));
    const res = await h.engine.tick();
    expect(res.outcomes).toHaveLength(1);
  });

  it("different facts maintain independent pending counts", async () => {
    let n = 0;
    const ex: Extractor = {
      extract(t): readonly ExtractedFact[] {
        n += 1;
        return [
          {
            type: "atomic",
            kind: MemoryKind.FACT,
            network: Network.OBSERVATION,
            content: `fact #${n}`,
            quote: t.content,
            confidence: 0.1,
          },
        ];
      },
    };
    const h = harness(ex, { skepticism: 1 });
    for (let i = 0; i < 4; i++) {
      h.buffer.append(turn(`t${i}`, "anything", i));
    }
    const res = await h.engine.tick();
    // Each turn yields a DIFFERENT fact — no fact accumulates 4 mentions,
    // so none of them persist.
    expect(res.outcomes).toHaveLength(0);
  });
});
