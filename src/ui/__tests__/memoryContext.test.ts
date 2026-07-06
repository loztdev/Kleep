import { ConversationBuffer, TurnRole, type Turn } from "../../conversation";
import {
  DedupReconciler,
  InMemoryStructuredStore,
  InMemoryVectorStore,
  MemoryRouter,
  StubEmbedder,
} from "../../index";
import { FusionRecallEngine, IndexingSink } from "../../retrieval";
import {
  ConfidenceSource,
  MemoryKind,
  Network,
  newId,
  type MemoryAsset,
} from "../../schema";
import { assembleMemoryContext } from "../memoryContext";

function turn(id: string, content: string, index: number, role: TurnRole = TurnRole.USER): Turn {
  return { id, role, content, index };
}

function fact(content: string, opts: { source_turn_id: string; entity_ids?: string[]; tags?: string[] }): MemoryAsset {
  return {
    id: newId(),
    network: Network.OBSERVATION,
    kind: MemoryKind.FACT,
    content,
    entity_ids: opts.entity_ids ?? [],
    tags: opts.tags ?? [],
    relevance: 0,
    provenance: {
      source_turn_id: opts.source_turn_id,
      confidence_score: 1,
      confidence_source: ConfidenceSource.USER_ASSERTED,
      raw_quote_anchors: [{ turn_id: opts.source_turn_id, quote: content.slice(0, 32) }],
      temporal_range: { turn_start: opts.source_turn_id, narrative_always: true },
    },
  };
}

function summary(content: string, opts: { turn_start: string; turn_end: string }): MemoryAsset {
  return {
    id: newId(),
    network: Network.EXPERIENCE,
    kind: MemoryKind.SUMMARY,
    content,
    entity_ids: [],
    tags: ["rolling-summary"],
    relevance: 0,
    provenance: {
      source_turn_id: opts.turn_end,
      confidence_score: 0.95,
      confidence_source: ConfidenceSource.DERIVED,
      raw_quote_anchors: [{ turn_id: opts.turn_end, quote: content.slice(0, 32) }],
      temporal_range: { turn_start: opts.turn_start, turn_end: opts.turn_end, narrative_always: false },
    },
  };
}

function harness() {
  const buffer = new ConversationBuffer();
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  const embedder = new StubEmbedder();
  const fusion = new FusionRecallEngine({ router, embedder });
  const reconciler = new DedupReconciler(router);
  const sink = new IndexingSink(reconciler, fusion);
  return { buffer, structured, vector, fusion, sink };
}

describe("assembleMemoryContext", () => {
  it("returns undefined when the store has nothing and recall finds nothing", async () => {
    const h = harness();
    const ctx = await assembleMemoryContext({
      structured: h.structured,
      fusion: h.fusion,
      buffer: h.buffer,
      query: "hello",
    });
    expect(ctx).toBeUndefined();
  });

  it("includes recent SUMMARY assets in chronological order under a Story-so-far heading", async () => {
    const h = harness();
    h.buffer.append(turn("t1", "Aaron walks into the tavern.", 0));
    h.buffer.append(turn("t2", "Aaron orders ale.", 1));
    h.buffer.append(turn("t3", "The bartender eyes him warily.", 2));

    h.sink.ingest(summary("Aaron arrives at the tavern.", { turn_start: "t1", turn_end: "t1" }));
    h.sink.ingest(summary("Aaron orders and is served warily.", { turn_start: "t2", turn_end: "t3" }));

    const ctx = await assembleMemoryContext({
      structured: h.structured,
      fusion: h.fusion,
      buffer: h.buffer,
      query: "what happens next?",
    });

    expect(ctx).toBeDefined();
    expect(ctx!).toContain("## Story so far");
    // Chronological order — earlier summary first.
    const arrivesIdx = ctx!.indexOf("Aaron arrives at the tavern.");
    const ordersIdx = ctx!.indexOf("Aaron orders and is served warily.");
    expect(arrivesIdx).toBeGreaterThan(-1);
    expect(ordersIdx).toBeGreaterThan(arrivesIdx);
  });

  it("caps summary count at maxSummaries, keeping the most recent", async () => {
    const h = harness();
    h.buffer.append(turn("t1", "a", 0));
    h.buffer.append(turn("t2", "b", 1));
    h.buffer.append(turn("t3", "c", 2));
    h.buffer.append(turn("t4", "d", 3));

    h.sink.ingest(summary("Old summary about a.", { turn_start: "t1", turn_end: "t1" }));
    h.sink.ingest(summary("Middle summary about b.", { turn_start: "t2", turn_end: "t2" }));
    h.sink.ingest(summary("Recent summary about c.", { turn_start: "t3", turn_end: "t3" }));
    h.sink.ingest(summary("Newest summary about d.", { turn_start: "t4", turn_end: "t4" }));

    const ctx = await assembleMemoryContext({
      structured: h.structured,
      fusion: h.fusion,
      buffer: h.buffer,
      query: "?",
      maxSummaries: 2,
    });

    // Keep newest two, drop the oldest two.
    expect(ctx!).not.toContain("Old summary about a.");
    expect(ctx!).not.toContain("Middle summary about b.");
    expect(ctx!).toContain("Recent summary about c.");
    expect(ctx!).toContain("Newest summary about d.");
  });

  it("drops summaries whose anchor turn is no longer in the buffer (e.g. after a truncate)", async () => {
    const h = harness();
    h.buffer.append(turn("t1", "Alice is a knight.", 0));
    // Ingest a summary whose anchor references a turn that was never
    // added to the buffer — mirrors the state after edit/regenerate
    // truncates the tail away.
    h.sink.ingest(summary("Alice defeats the dragon.", { turn_start: "gone", turn_end: "gone" }));

    const ctx = await assembleMemoryContext({
      structured: h.structured,
      fusion: h.fusion,
      buffer: h.buffer,
      query: "what happened?",
    });

    // Only the stranded summary was written; nothing valid to show, and
    // fusion recall over "what happened?" won't score it since there's
    // no anchor. Result should be undefined.
    expect(ctx).toBeUndefined();
  });

  it("adds a Relevant memories block for BM25-recalled FACTs", async () => {
    const h = harness();
    h.buffer.append(turn("t1", "seed", 0));
    h.sink.ingest(fact("Mojo is a puppy.", { source_turn_id: "t1" }));
    h.sink.ingest(fact("Aaron's favorite color is blue.", { source_turn_id: "t1" }));

    const ctx = await assembleMemoryContext({
      structured: h.structured,
      fusion: h.fusion,
      buffer: h.buffer,
      query: "tell me about the puppy",
    });

    expect(ctx).toBeDefined();
    expect(ctx!).toContain("## Relevant memories");
    expect(ctx!).toContain("Mojo is a puppy.");
  });

  it("deduplicates a recalled asset that already appears as a summary", async () => {
    const h = harness();
    h.buffer.append(turn("t1", "seed", 0));
    const s = summary("Mojo is a puppy.", { turn_start: "t1", turn_end: "t1" });
    h.sink.ingest(s);
    // Ingesting a SUMMARY makes it retrievable via BM25 too. Recall
    // might surface it — the assembler must not print it twice.

    const ctx = await assembleMemoryContext({
      structured: h.structured,
      fusion: h.fusion,
      buffer: h.buffer,
      query: "puppy",
    });

    expect(ctx).toBeDefined();
    // Content appears exactly once across the block.
    const matches = ctx!.match(/Mojo is a puppy\./g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("trims the block to the token budget by dropping lines from the end", async () => {
    const h = harness();
    h.buffer.append(turn("t1", "seed", 0));
    for (let i = 0; i < 20; i++) {
      h.sink.ingest(fact(`Aaron fact number ${i} with some extra padding text.`, { source_turn_id: "t1" }));
    }

    const generous = await assembleMemoryContext({
      structured: h.structured,
      fusion: h.fusion,
      buffer: h.buffer,
      query: "Aaron",
      tokenBudget: 10_000,
    });
    const tight = await assembleMemoryContext({
      structured: h.structured,
      fusion: h.fusion,
      buffer: h.buffer,
      query: "Aaron",
      tokenBudget: 50,
    });

    expect(generous).toBeDefined();
    expect(tight).toBeDefined();
    expect(tight!.length).toBeLessThan(generous!.length);
  });

  it("skips fusion recall when the query is empty/whitespace but still emits summaries", async () => {
    const h = harness();
    h.buffer.append(turn("t1", "seed", 0));
    h.sink.ingest(summary("Something happened once.", { turn_start: "t1", turn_end: "t1" }));
    h.sink.ingest(fact("Aaron is a wizard.", { source_turn_id: "t1" }));

    const ctx = await assembleMemoryContext({
      structured: h.structured,
      fusion: h.fusion,
      buffer: h.buffer,
      query: "   ",
    });

    expect(ctx).toBeDefined();
    expect(ctx!).toContain("## Story so far");
    expect(ctx!).toContain("Something happened once.");
    // Recall never ran — the fact block should not appear.
    expect(ctx!).not.toContain("## Relevant memories");
  });
});
