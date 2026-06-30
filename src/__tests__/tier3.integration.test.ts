/**
 * Tier 3 end-to-end integration.
 *
 * A longer conversation streams in. The full pipeline runs:
 *
 *   buffer
 *     → AutoRetainEngine
 *     → DedupReconciler
 *     → IndexingSink  (mirrors into BM25/entity/recency)
 *     → MemoryRouter
 *     → structured + vector stores
 *
 * Then:
 *   - FusionRecallEngine.recall(query) returns ranked, scoped, budgeted hits
 *   - RollingSummarizer rolls long windows into SUMMARY assets
 *   - The summary is re-discoverable through fusion recall
 */

import {
  AutoRetainEngine,
  ConversationBuffer,
  DedupReconciler,
  FusionRecallEngine,
  InMemoryStructuredStore,
  InMemoryVectorStore,
  IndexingSink,
  MemoryKind,
  MemoryRouter,
  Network,
  PatternExtractor,
  RollingSummarizer,
  StubEmbedder,
  StubSummarizer,
  TurnRole,
  type Turn,
} from "../index";

function turn(id: string, content: string, index = 0): Turn {
  return { id, role: TurnRole.USER, content, index };
}

function pipeline() {
  const buffer = new ConversationBuffer();
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  const reconciler = new DedupReconciler(router);
  const embedder = new StubEmbedder();
  const fusion = new FusionRecallEngine({ router, embedder });
  const sink = new IndexingSink(reconciler, fusion);
  const engine = new AutoRetainEngine(buffer, new PatternExtractor(), sink, {
    embedder,
  });
  const summarizer = new RollingSummarizer(
    buffer,
    new StubSummarizer(),
    sink,
    { threshold: 30, windowSize: 3 },
  );
  return {
    buffer,
    structured,
    vector,
    router,
    fusion,
    engine,
    summarizer,
  };
}

describe("Tier 3 integration — fusion recall", () => {
  it("a real conversation lets fusion recall find the right facts", async () => {
    const p = pipeline();
    p.buffer.append(turn("t1", "Mojo is a puppy.", 0));
    p.buffer.append(turn("t2", "Mojo is at Park.", 1));
    p.buffer.append(turn("t3", "Alice cooked dinner.", 2));
    p.buffer.append(turn("t4", "Alice thinks Mojo is sweet.", 3));
    await p.engine.tick();

    // Query about Mojo: entity-graph + bm25 should converge.
    const out = await p.fusion.recall("Where is Mojo?");
    expect(out.length).toBeGreaterThan(0);
    // The "Mojo is at Park" fact should rank in the top three.
    const top3 = out.slice(0, 3).map((r) => r.asset.content);
    expect(top3.some((c) => c.includes("Park"))).toBe(true);
  });

  it("opinion isolation: Alice's view doesn't leak into Bob's", async () => {
    const p = pipeline();
    p.buffer.append(turn("t1", "Alice thinks the king is weak.", 0));
    p.buffer.append(turn("t2", "Bob thinks the king is strong.", 1));
    await p.engine.tick();

    const aliceView = await p.fusion.recall("king", {
      network: Network.OPINION,
      viewpoint_holder: "Alice",
    });
    expect(aliceView).toHaveLength(1);
    expect(aliceView[0]!.asset.viewpoint_holder).toBe("Alice");
  });

  it("budgeted recall keeps total tokens under the cap", async () => {
    const p = pipeline();
    for (let i = 0; i < 10; i++) {
      p.buffer.append(turn(`t${i}`, "Mojo is at Park.", i));
    }
    await p.engine.tick();
    // Dedup means there's really only one fact, plus an entity card.
    // Tiny budget should still produce <=1 result.
    const out = await p.fusion.recall("Mojo", { tokenBudget: 6 });
    const total = out.reduce((s, r) => s + r.tokens, 0);
    expect(total).toBeLessThanOrEqual(6);
  });
});

describe("Tier 3 integration — rolling summarization", () => {
  it("long conversation triggers a summary, summarized turns drop from live tokens", async () => {
    const p = pipeline();
    // Each turn is ~25 tokens (chars/4 of 100 chars).
    for (let i = 0; i < 6; i++) {
      p.buffer.append(turn(`t${i}`, "x".repeat(100), i));
    }

    const liveBefore = p.buffer.liveTokenCount(
      (s: string) => Math.ceil(s.length / 4),
    );
    expect(liveBefore).toBeGreaterThanOrEqual(30);

    const res = await p.summarizer.tick();
    expect(res.summariesProduced).toBeGreaterThanOrEqual(1);

    const liveAfter = p.buffer.liveTokenCount(
      (s: string) => Math.ceil(s.length / 4),
    );
    expect(liveAfter).toBeLessThan(liveBefore);
    expect(p.buffer.summarizedCount()).toBeGreaterThan(0);
  });

  it("summary is retrievable via fusion recall and reconciler-indexed", async () => {
    const p = pipeline();
    p.buffer.append(turn("t1", "Mojo went hunting.", 0));
    p.buffer.append(turn("t2", "Mojo caught a rabbit.", 1));
    p.buffer.append(turn("t3", "Mojo returned home tired.", 2));
    await p.engine.tick();
    await p.summarizer.flush();

    // The SUMMARY asset is in the structured store...
    const summaries = p.structured.query({ kind: MemoryKind.SUMMARY });
    expect(summaries).toHaveLength(1);

    // ...and indexed for fusion (chronological channel will surface it
    // because its source_turn_id is t3, the most recent).
    const out = await p.fusion.recall("anything", {
      channels: { vector: false, bm25: false, entity: false },
    });
    expect(out.some((r) => r.asset.kind === MemoryKind.SUMMARY)).toBe(true);
  });

  it("summary anchors point back to the original turns (audit trail)", async () => {
    const p = pipeline();
    p.buffer.append(turn("t1", "first event", 0));
    p.buffer.append(turn("t2", "second event", 1));
    p.buffer.append(turn("t3", "third event", 2));
    await p.summarizer.flush();
    const sum = p.structured.query({ kind: MemoryKind.SUMMARY })[0]!;
    const anchorTurnIds = sum.provenance.raw_quote_anchors.map(
      (a) => a.turn_id,
    );
    expect(anchorTurnIds).toEqual(["t1", "t2", "t3"]);
  });
});

describe("Tier 3 integration — extraction + retrieval + summarization together", () => {
  it("everything composes: ingest, recall, summarize, recall again", async () => {
    const p = pipeline();

    // Phase 1: ingest a few turns
    p.buffer.append(turn("t1", "Mojo is a puppy.", 0));
    p.buffer.append(turn("t2", "Mojo is at Park.", 1));
    await p.engine.tick();

    // Phase 2: recall something
    const recall1 = await p.fusion.recall("Mojo");
    expect(recall1.length).toBeGreaterThan(0);

    // Phase 3: add more turns and force a summary
    p.buffer.append(turn("t3", "a".repeat(80), 2));
    p.buffer.append(turn("t4", "b".repeat(80), 3));
    p.buffer.append(turn("t5", "c".repeat(80), 4));
    await p.engine.tick();
    const sres = await p.summarizer.flush();
    expect(sres.summariesProduced).toBeGreaterThan(0);

    // Phase 4: original recall still works (entities survive)
    const recall2 = await p.fusion.recall("Mojo");
    expect(recall2.length).toBeGreaterThan(0);
  });
});
