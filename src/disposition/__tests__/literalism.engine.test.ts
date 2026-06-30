/**
 * Tier 4.10 — literalism boost in FusionRecallEngine.
 */

import {
  ConfidenceSource,
  FusionRecallEngine,
  InMemoryStructuredStore,
  InMemoryVectorStore,
  MemoryAssetSchema,
  MemoryKind,
  MemoryRouter,
  Network,
  ProvenanceSchema,
  RawQuoteAnchorSchema,
  TemporalRangeSchema,
  newId,
  type MemoryAsset,
} from "../../index";

function fact(network: Network, content: string): MemoryAsset {
  return MemoryAssetSchema.parse({
    id: newId(),
    network,
    kind: MemoryKind.FACT,
    content,
    provenance: ProvenanceSchema.parse({
      source_turn_id: "t1",
      confidence_score: 0.7,
      confidence_source: ConfidenceSource.INFERRED,
      raw_quote_anchors: [
        RawQuoteAnchorSchema.parse({ turn_id: "t1", quote: content }),
      ],
      temporal_range: TemporalRangeSchema.parse({ turn_start: "t1" }),
    }),
  });
}

function harness(disposition?: { literalism: number }) {
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  const fusion = new FusionRecallEngine({ router, disposition });
  return { router, fusion };
}

describe("FusionRecallEngine — literalism boost", () => {
  it("neutral literalism: WORLD and OBSERVATION rank by raw RRF", async () => {
    const h = harness();
    const world = fact(Network.WORLD, "the sky is blue");
    const observation = fact(Network.OBSERVATION, "the sky is blue");
    h.router.write(world);
    h.router.write(observation);
    h.fusion.index(world);
    h.fusion.index(observation);

    const out = await h.fusion.recall("sky blue", {
      channels: { vector: false, entity: false, chronological: false },
    });
    expect(out).toHaveLength(2);
    // With same content, BM25 scores are equal and RRF ranks are equal,
    // so the unboosted order can be either. We just check both present.
    expect(new Set(out.map((r) => r.asset.id))).toEqual(
      new Set([world.id, observation.id]),
    );
  });

  it("full literalism: WORLD outranks OBSERVATION even with same BM25 score", async () => {
    const h = harness({ literalism: 1 });
    const world = fact(Network.WORLD, "the sky is blue");
    const observation = fact(Network.OBSERVATION, "the sky is blue");
    h.router.write(world);
    h.router.write(observation);
    h.fusion.index(world);
    h.fusion.index(observation);

    const out = await h.fusion.recall("sky blue", {
      channels: { vector: false, entity: false, chronological: false },
    });
    expect(out[0]!.asset.id).toBe(world.id);
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it("per-call disposition overrides engine default", async () => {
    const h = harness({ literalism: 0 }); // engine default: no boost
    const world = fact(Network.WORLD, "stars shine");
    const observation = fact(Network.OBSERVATION, "stars shine");
    h.router.write(world);
    h.router.write(observation);
    h.fusion.index(world);
    h.fusion.index(observation);

    const boosted = await h.fusion.recall("stars shine", {
      channels: { vector: false, entity: false, chronological: false },
      disposition: { literalism: 1 },
    });
    expect(boosted[0]!.asset.id).toBe(world.id);
  });

  it("literalism does not affect non-WORLD ordering relative to each other", async () => {
    const h = harness({ literalism: 1 });
    const exp = fact(Network.EXPERIENCE, "Mojo is at Park");
    const obs = fact(Network.OBSERVATION, "Mojo is at Park");
    h.router.write(exp);
    h.router.write(obs);
    h.fusion.index(exp);
    h.fusion.index(obs);
    const out = await h.fusion.recall("Mojo Park", {
      channels: { vector: false, entity: false, chronological: false },
    });
    // No WORLD asset present; both should appear unboosted, in tied order.
    expect(out).toHaveLength(2);
  });
});
