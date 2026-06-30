/**
 * Tier 4 end-to-end integration.
 *
 * Exercises all three Tier 4 pieces against the full pipeline:
 *
 *   - 4.8 — explain() returns the right bundle for an emitted REFLECTION,
 *           with anchors that trace back to the source turn.
 *   - 4.9 — ReflectionEngine detects an opinion contradiction and emits
 *           a REFLECTION through the ingest path; the reflection is
 *           queryable and explainable.
 *   - 4.10 — High-skepticism AutoRetainEngine rejects a single-mention
 *            low-confidence fact, accepts it after corroboration; high-
 *            literalism FusionRecallEngine ranks WORLD assets above
 *            equivalent OBSERVATION assets.
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
  ReflectionEngine,
  RouterSink,
  StubEmbedder,
  StubReflector,
  TurnRole,
  type ExtractedFact,
  type Extractor,
  type Turn,
} from "../index";
import { explain } from "../explain";
import {
  makeFact,
  makeOpinion,
} from "../storage/__tests__/fixtures";

function turn(id: string, content: string, idx = 0): Turn {
  return { id, role: TurnRole.USER, content, index: idx };
}

function lowConf(content: string, confidence: number): Extractor {
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

describe("Tier 4 integration — explain + reflection", () => {
  it("CARA emits a REFLECTION and explain() returns a usable bundle", async () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    void new DedupReconciler(router);
    const sink = new RouterSink(router);

    const alice = makeOpinion("alice", {
      content: "The king is strong.",
      entity_ids: ["king"],
    });
    const bob = makeOpinion("bob", {
      content: "The king is not strong.",
      entity_ids: ["king"],
    });
    router.write(alice);
    router.write(bob);

    const reflector = new StubReflector();
    const cara = new ReflectionEngine(router, reflector, sink);
    const res = await cara.tick();
    expect(res.outcomes.length).toBeGreaterThanOrEqual(1);

    const reflections = structured.query({ kind: MemoryKind.REFLECTION });
    expect(reflections.length).toBeGreaterThanOrEqual(1);

    const bundle = explain(reflections[0]!);
    expect(bundle.subject.kind).toBe(MemoryKind.REFLECTION);
    expect(bundle.subject.headline.length).toBeGreaterThan(0);
    expect(bundle.confidence.source).toBe("derived");
    expect(bundle.anchors.length).toBeGreaterThan(0);
    expect(bundle.tags).toContain("cara-reflection");
  });

  it("explain() on a corroborated opinion reflects its updated confidence", async () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    void new DedupReconciler(router);
    const sink = new RouterSink(router);

    // Match content exactly so StubReflector flags corroboration.
    const op = makeOpinion("alice", { content: "matched-claim" });
    const fact = makeFact({
      content: "matched-claim",
      network: Network.OBSERVATION,
    });
    router.write(op);
    router.write(fact);

    const before = op.provenance.confidence_score;
    await new ReflectionEngine(router, new StubReflector(), sink).tick();
    const after = router.read(op.id)!.provenance.confidence_score;
    expect(after).toBeGreaterThan(before);

    const bundle = explain(router.read(op.id)!);
    expect(bundle.confidence.score).toBe(after);
  });
});

describe("Tier 4 integration — disposition matrix end-to-end", () => {
  it("high skepticism + corroboration: same fact across 4 turns finally persists", async () => {
    const buffer = new ConversationBuffer();
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    void new DedupReconciler(router);
    const embedder = new StubEmbedder();
    const fusion = new FusionRecallEngine({ router, embedder });
    const sink = new IndexingSink(new RouterSink(router), fusion);
    const engine = new AutoRetainEngine(
      buffer,
      lowConf("Mojo is at Park.", 0.2),
      sink,
      { disposition: { skepticism: 1 }, embedder },
    );

    for (let i = 0; i < 3; i++) {
      buffer.append(turn(`t${i}`, "anything", i));
    }
    let res = await engine.tick();
    expect(res.outcomes).toHaveLength(0);
    expect(structured.size()).toBe(0);

    buffer.append(turn("t3", "anything", 3));
    res = await engine.tick();
    expect(res.outcomes.length).toBeGreaterThanOrEqual(1);
    expect(structured.size()).toBeGreaterThanOrEqual(1);
  });

  it("high literalism: a recalled WORLD fact outranks an equivalent OBSERVATION", async () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    const fusion = new FusionRecallEngine({
      router,
      disposition: { literalism: 1 },
    });

    const worldFact = makeFact({
      content: "gravity pulls down",
      network: Network.WORLD,
    });
    const obsFact = makeFact({
      content: "gravity pulls down",
      network: Network.OBSERVATION,
    });
    router.write(worldFact);
    router.write(obsFact);
    fusion.index(worldFact);
    fusion.index(obsFact);

    const out = await fusion.recall("gravity", {
      channels: { vector: false, entity: false, chronological: false },
    });
    expect(out[0]!.asset.id).toBe(worldFact.id);
  });
});

describe("Tier 4 integration — explain over Tier 2/3 outputs", () => {
  it("explain() works on a SUMMARY asset emitted by the rolling summarizer", async () => {
    const {
      RollingSummarizer,
      StubSummarizer,
    } = require("../summarization");

    const buffer = new ConversationBuffer();
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    void new DedupReconciler(router);
    const sink = new RouterSink(router);
    const summarizer = new RollingSummarizer(
      buffer,
      new StubSummarizer(),
      sink,
      { threshold: 1, windowSize: 3 },
    );

    buffer.append(turn("t1", "first event", 0));
    buffer.append(turn("t2", "second event", 1));
    buffer.append(turn("t3", "third event", 2));
    await summarizer.flush();

    const summary = structured.query({ kind: MemoryKind.SUMMARY })[0]!;
    const bundle = explain(summary);
    expect(bundle.subject.kind).toBe(MemoryKind.SUMMARY);
    expect(bundle.anchors).toHaveLength(3);
    expect(bundle.anchors.map((a) => a.turn_id)).toEqual([
      "t3",
      "t1",
      "t2",
    ]); // source-turn first (t3), then chronologically
  });
});
