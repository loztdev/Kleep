import {
  ConversationBuffer,
  TurnRole,
  type Turn,
} from "../../conversation";
import {
  DedupReconciler,
  InMemoryStructuredStore,
  InMemoryVectorStore,
  MemoryKind,
  MemoryRouter,
  Network,
  RouterSink,
} from "../../index";
import { RollingSummarizer } from "../rollingSummarizer";
import { StubSummarizer } from "../stubSummarizer";

function turn(id: string, content: string, index = 0): Turn {
  return { id, role: TurnRole.USER, content, index };
}

function harness(threshold = 100, windowSize = 3) {
  const buffer = new ConversationBuffer();
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  const reconciler = new DedupReconciler(router);
  // Reconciler is the sink so summaries dedupe like any other asset.
  void reconciler;
  const sink = new RouterSink(router);
  const summarizer = new StubSummarizer();
  const rolling = new RollingSummarizer(buffer, summarizer, sink, {
    threshold,
    windowSize,
  });
  return { buffer, structured, router, rolling, summarizer };
}

describe("StubSummarizer", () => {
  it("produces a deterministic delta string", () => {
    const s = new StubSummarizer();
    const out = s.summarize([
      turn("t1", "Mojo went to Park.", 0),
      turn("t2", "Alice cooked dinner.", 1),
    ]);
    expect(out).toContain("t1..t2");
    expect(out).toContain("2 turns");
    expect(out).toContain("Mojo");
    expect(out).toContain("Alice");
  });

  it("handles an empty window", () => {
    expect(new StubSummarizer().summarize([])).toBe("[empty window]");
  });
});

describe("RollingSummarizer.tick — threshold-driven", () => {
  it("does nothing while below the threshold", async () => {
    const h = harness(1000, 3);
    h.buffer.append(turn("t1", "short", 0));
    const res = await h.rolling.tick();
    expect(res.summariesProduced).toBe(0);
    expect(h.buffer.summarizedCount()).toBe(0);
  });

  it("rolls one window when threshold is crossed", async () => {
    const h = harness(20, 3); // chars/4 estimate; 20 tokens ≈ 80 chars
    h.buffer.append(turn("t1", "a".repeat(50), 0)); // ~13 tokens
    h.buffer.append(turn("t2", "b".repeat(50), 1)); // ~13 tokens
    h.buffer.append(turn("t3", "c".repeat(50), 2)); // ~13 tokens → ~39 total
    const res = await h.rolling.tick();
    expect(res.summariesProduced).toBeGreaterThanOrEqual(1);
    expect(h.buffer.isSummarized("t1")).toBe(true);
  });

  it("loops until live tokens fall below threshold", async () => {
    const h = harness(10, 2);
    for (let i = 0; i < 6; i++) {
      h.buffer.append(turn(`t${i}`, "x".repeat(40), i)); // ~10 each
    }
    const res = await h.rolling.tick();
    // 6 turns @ 10 tokens = 60 tokens; threshold 10, window 2 → multiple rounds
    expect(res.summariesProduced).toBeGreaterThan(1);
  });

  it("does not re-summarize already-summarized turns", async () => {
    const h = harness(20, 2);
    h.buffer.append(turn("t1", "a".repeat(100), 0));
    h.buffer.append(turn("t2", "b".repeat(100), 1));
    await h.rolling.tick();
    const before = h.buffer.summarizedCount();
    await h.rolling.tick();
    expect(h.buffer.summarizedCount()).toBe(before);
  });
});

describe("RollingSummarizer.flush", () => {
  it("force-summarizes regardless of threshold", async () => {
    const h = harness(1_000_000, 3);
    h.buffer.append(turn("t1", "short", 0));
    h.buffer.append(turn("t2", "short", 1));
    const res = await h.rolling.flush();
    expect(res.summariesProduced).toBe(1);
    expect(h.buffer.isSummarized("t1")).toBe(true);
    expect(h.buffer.isSummarized("t2")).toBe(true);
  });

  it("no-ops on empty buffer", async () => {
    const h = harness();
    const res = await h.rolling.flush();
    expect(res.summariesProduced).toBe(0);
  });
});

describe("RollingSummarizer — emitted asset shape", () => {
  it("creates a SUMMARY MemoryAsset in EXPERIENCE by default", async () => {
    const h = harness(1, 2);
    h.buffer.append(turn("t1", "first", 0));
    h.buffer.append(turn("t2", "second", 1));
    await h.rolling.tick();
    const found = h.structured.query({
      kind: MemoryKind.SUMMARY,
    });
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.network).toBe(Network.EXPERIENCE);
  });

  it("provenance pins one anchor per summarized turn", async () => {
    const h = harness(1, 3);
    h.buffer.append(turn("t1", "first turn", 0));
    h.buffer.append(turn("t2", "second turn", 1));
    h.buffer.append(turn("t3", "third turn", 2));
    await h.rolling.flush();
    const sum = h.structured.query({ kind: MemoryKind.SUMMARY })[0]!;
    expect(sum.provenance.raw_quote_anchors).toHaveLength(3);
    const turnIds = sum.provenance.raw_quote_anchors.map((a) => a.turn_id);
    expect(turnIds).toEqual(["t1", "t2", "t3"]);
  });

  it("temporal_range spans first → last turn id", async () => {
    const h = harness(1, 3);
    h.buffer.append(turn("t1", "first", 0));
    h.buffer.append(turn("t2", "second", 1));
    h.buffer.append(turn("t3", "third", 2));
    await h.rolling.flush();
    const sum = h.structured.query({ kind: MemoryKind.SUMMARY })[0]!;
    expect(sum.provenance.temporal_range.turn_start).toBe("t1");
    expect(sum.provenance.temporal_range.turn_end).toBe("t3");
  });

  it("source_turn_id is the last turn (when the summary is true)", async () => {
    const h = harness(1, 3);
    h.buffer.append(turn("t1", "first", 0));
    h.buffer.append(turn("t2", "second", 1));
    h.buffer.append(turn("t3", "third", 2));
    await h.rolling.flush();
    const sum = h.structured.query({ kind: MemoryKind.SUMMARY })[0]!;
    expect(sum.provenance.source_turn_id).toBe("t3");
  });
});

describe("ConversationBuffer — summarization-aware helpers", () => {
  it("liveTokenCount excludes summarized turns", () => {
    const b = new ConversationBuffer();
    b.append(turn("t1", "aaaa", 0));
    b.append(turn("t2", "bbbb", 1));
    const est = (s: string) => s.length;
    expect(b.liveTokenCount(est)).toBe(8);
    b.markSummarized(["t1"]);
    expect(b.liveTokenCount(est)).toBe(4);
  });

  it("liveTurns excludes summarized turns", () => {
    const b = new ConversationBuffer();
    b.append(turn("t1", "x", 0));
    b.append(turn("t2", "y", 1));
    b.markSummarized(["t1"]);
    expect(b.liveTurns().map((t) => t.id)).toEqual(["t2"]);
  });

  it("markSummarized ignores unknown ids", () => {
    const b = new ConversationBuffer();
    b.append(turn("t1", "x", 0));
    b.markSummarized(["unknown"]);
    expect(b.summarizedCount()).toBe(0);
  });
});
