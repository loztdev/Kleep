import {
  ConversationBuffer,
  TurnRole,
  type Turn,
} from "../../conversation";
import {
  AutoRetainEngine,
  DedupReconciler,
  InMemoryStructuredStore,
  InMemoryVectorStore,
  MemoryKind,
  MemoryRouter,
  Network,
  PatternExtractor,
  StubEmbedder,
} from "../../index";
import { FusionRecallEngine } from "../fusionRecallEngine";
import { IndexingSink } from "../indexingSink";

function turn(id: string, content: string, index = 0): Turn {
  return { id, role: TurnRole.USER, content, index };
}

function harness() {
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
  return { buffer, structured, vector, router, fusion, engine };
}

async function ingest(h: ReturnType<typeof harness>, turns: Turn[]) {
  for (const t of turns) h.buffer.append(t);
  await h.engine.tick();
}

describe("FusionRecallEngine — channel basics", () => {
  it("recalls a fact via BM25 keyword match", async () => {
    const h = harness();
    await ingest(h, [
      turn("t1", "Mojo is a puppy.", 0),
      turn("t2", "Alice is at Park.", 1),
    ]);
    const out = await h.fusion.recall("puppy", {
      channels: { vector: false, entity: false, chronological: false },
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.asset.content.toLowerCase()).toContain("puppy");
    expect(out[0]!.channels).toEqual(["bm25"]);
  });

  it("recalls via entity mention in the query", async () => {
    const h = harness();
    await ingest(h, [
      turn("t1", "Mojo is a puppy.", 0),
      turn("t2", "Mojo is at Park.", 1),
      turn("t3", "Alice cooked dinner.", 2),
    ]);
    const out = await h.fusion.recall("Where did Mojo go?", {
      channels: { vector: false, bm25: false, chronological: false },
    });
    expect(out.length).toBeGreaterThan(0);
    // Everything returned should reference Mojo somehow.
    for (const r of out) {
      const refs =
        (r.asset as { entity_ids?: readonly string[] }).entity_ids ?? [];
      const isCard = r.asset.kind === MemoryKind.ENTITY;
      expect(isCard || refs.includes("Mojo")).toBe(true);
    }
  });

  it("chronological channel surfaces most-recent assets", async () => {
    const h = harness();
    await ingest(h, [
      turn("t01", "Mojo is at Park.", 0),
      turn("t02", "Alice is at Park.", 1),
      turn("t03", "Bob is at Park.", 2),
    ]);
    const out = await h.fusion.recall("anything", {
      channels: { vector: false, bm25: false, entity: false },
    });
    expect(out.length).toBeGreaterThan(0);
    // The most-recent turn id wins.
    const topKeys = out.slice(0, 3).map((r) =>
      r.asset.last_updated_turn ?? r.asset.provenance.source_turn_id,
    );
    expect(topKeys[0]).toBe("t03");
  });

  it("vector channel returns embedded LORE that semantically matches", async () => {
    const h = harness();
    // Hand-route a LORE asset via the engine using a custom extractor.
    // Easier: use the engine's LORE path via a manual lore extractor.
    // Here we just write through the router/index for clarity.
    const embedder = new StubEmbedder();
    const { LoreSnippetSchema } = await import("../../schema");
    const { makeProvenance } = await import(
      "../../schema/__tests__/fixtures"
    );
    const lore = LoreSnippetSchema.parse({
      network: Network.WORLD,
      content: "the desert hums at noon",
      provenance: makeProvenance(),
      embedding: [...(embedder.embed("the desert hums at noon") as number[])],
      embedding_model: embedder.model,
    });
    h.router.write(lore);
    h.fusion.index(lore);
    const out = await h.fusion.recall("the desert hums at noon", {
      channels: { bm25: false, entity: false, chronological: false },
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.channels).toEqual(["vector"]);
  });
});

describe("FusionRecallEngine — fusion (RRF)", () => {
  it("an asset surfaced by multiple channels outranks single-channel hits", async () => {
    const h = harness();
    await ingest(h, [
      turn("t1", "Mojo is a puppy.", 0),
      turn("t2", "Alice cooked dinner.", 1),
    ]);
    // "Mojo puppy" hits BM25 (puppy + Mojo) AND entity-graph (Mojo mention)
    // for the entity card; expect a multi-channel hit at the top.
    const out = await h.fusion.recall("Mojo puppy");
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.channels.length).toBeGreaterThan(1);
  });
});

describe("FusionRecallEngine — scope filters", () => {
  it("network filter excludes off-scope assets", async () => {
    const h = harness();
    await ingest(h, [
      turn("t1", "Mojo is at Park.", 0), // EXPERIENCE fact
      turn("t2", "Alice thinks Mojo is sweet.", 1), // OPINION
    ]);
    const exp = await h.fusion.recall("Mojo", {
      network: Network.EXPERIENCE,
    });
    expect(exp.length).toBeGreaterThan(0);
    expect(exp.every((r) => r.asset.network === Network.EXPERIENCE)).toBe(
      true,
    );
  });

  it("viewpoint_holder filter keeps Alice's opinions from leaking to Bob's view", async () => {
    const h = harness();
    await ingest(h, [
      turn("t1", "Alice thinks the king is weak.", 0),
      turn("t2", "Bob thinks the king is weak.", 1),
    ]);
    const alice = await h.fusion.recall("king weak", {
      viewpoint_holder: "Alice",
      network: Network.OPINION,
    });
    expect(alice.length).toBeGreaterThan(0);
    expect(alice.every((r) => r.asset.viewpoint_holder === "Alice")).toBe(
      true,
    );
  });
});

describe("FusionRecallEngine — budgets", () => {
  it("token budget caps the total estimated tokens", async () => {
    const h = harness();
    await ingest(h, [
      turn("t01", "Mojo is at Park.", 0),
      turn("t02", "Alice is at Park.", 1),
      turn("t03", "Bob is at Park.", 2),
      turn("t04", "Eve is at Park.", 3),
    ]);
    const out = await h.fusion.recall("Park", { tokenBudget: 5 });
    const total = out.reduce((s, r) => s + r.tokens, 0);
    expect(total).toBeLessThanOrEqual(5);
  });

  it("topK caps result count", async () => {
    const h = harness();
    await ingest(h, [
      turn("t01", "Mojo is at Park.", 0),
      turn("t02", "Alice is at Park.", 1),
      turn("t03", "Bob is at Park.", 2),
    ]);
    const out = await h.fusion.recall("Park", { topK: 1 });
    expect(out).toHaveLength(1);
  });

  it("empty index returns []", async () => {
    const h = harness();
    expect(await h.fusion.recall("anything")).toEqual([]);
  });
});

describe("FusionRecallEngine — re-indexing", () => {
  it("re-indexing after a state change reflects the new content", async () => {
    const h = harness();
    await ingest(h, [turn("t1", "Mojo is a puppy.", 0)]);
    // Now manually replace the entry via the router and re-index.
    const entry = h.structured.getEntry("char:mojo")!;
    const updated = {
      ...entry,
      canonical_name: "Mojo",
      aliases: ["MJ"],
    };
    h.router.write(updated);
    h.fusion.index(updated);
    expect(h.fusion["entities" as never]).toBeDefined(); // sanity
    const out = await h.fusion.recall("MJ", {
      channels: { vector: false, bm25: false, chronological: false },
    });
    expect(out.length).toBeGreaterThan(0);
  });

  it("remove() drops from all indexes", async () => {
    const h = harness();
    await ingest(h, [turn("t1", "Mojo is at Park.", 0)]);
    const asset = h.structured.query({ kind: MemoryKind.FACT })[0]!;
    h.fusion.remove(asset.id);
    const out = await h.fusion.recall("Park");
    expect(out.find((r) => r.asset.id === asset.id)).toBeUndefined();
  });
});
