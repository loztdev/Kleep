import {
  ConfidenceSource,
  MemoryKind,
  Network,
  ProvenanceSchema,
  RawQuoteAnchorSchema,
  TemporalRangeSchema,
} from "../../schema";
import {
  DedupReconciler,
  InMemoryStructuredStore,
  InMemoryVectorStore,
  MemoryRouter,
  RouterSink,
} from "../../index";
import {
  makeFact,
  makeOpinion,
} from "../../storage/__tests__/fixtures";
import { ReflectionEngine } from "../reflectionEngine";
import { StubReflector } from "../stubReflector";
import type { Reflector, ReflectionFinding } from "../types";

function harness(reflector: Reflector = new StubReflector()) {
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  void new DedupReconciler(router);
  const sink = new RouterSink(router);
  return {
    structured,
    router,
    engine: new ReflectionEngine(router, reflector, sink),
  };
}

describe("ReflectionEngine.tick — empty input", () => {
  it("no-ops when there are no opinions", async () => {
    const h = harness();
    const res = await h.engine.tick();
    expect(res.findings).toEqual([]);
    expect(res.outcomes).toEqual([]);
    expect(res.adjustedAssets).toBe(0);
  });
});

describe("ReflectionEngine.tick — contradiction", () => {
  it("emits a REFLECTION asset and lowers confidence on the primary", async () => {
    const h = harness();
    const alice = makeOpinion("alice", {
      content: "The king is strong.",
      entity_ids: ["king"],
    });
    const bob = makeOpinion("bob", {
      content: "The king is not strong.",
      entity_ids: ["king"],
    });
    h.router.write(alice);
    h.router.write(bob);

    const res = await h.engine.tick();
    expect(res.findings.length).toBeGreaterThanOrEqual(1);
    const reflections = h.structured.query({ kind: MemoryKind.REFLECTION });
    expect(reflections.length).toBeGreaterThanOrEqual(1);
    expect(reflections[0]!.tags).toContain("cara-reflection");
    expect(reflections[0]!.tags).toContain("cara:contradiction");

    // Confidence should drop on whichever opinion was the primary.
    const primaryId = res.findings[0]!.primary_asset_id;
    const lowered = h.router.read(primaryId);
    expect(lowered!.provenance.confidence_score).toBeLessThan(0.9);
  });
});

describe("ReflectionEngine.tick — corroboration", () => {
  it("raises confidence on a corroborated opinion", async () => {
    const h = harness();
    const op = makeOpinion("alice", {
      content: "Mojo is at Park.",
      entity_ids: ["Mojo", "Park"],
      provenance: ProvenanceSchema.parse({
        source_turn_id: "t1",
        confidence_score: 0.5,
        confidence_source: ConfidenceSource.INFERRED,
        raw_quote_anchors: [
          RawQuoteAnchorSchema.parse({ turn_id: "t1", quote: "Mojo is at Park." }),
        ],
        temporal_range: TemporalRangeSchema.parse({ turn_start: "t1" }),
      }),
    });
    const fact = makeFact({
      content: "Mojo is at Park.",
      entity_ids: ["Mojo", "Park"],
      kind: MemoryKind.FACT,
      network: Network.EXPERIENCE,
    });
    h.router.write(op);
    h.router.write(fact);

    const res = await h.engine.tick();
    expect(res.adjustedAssets).toBeGreaterThanOrEqual(1);
    const updated = h.router.read(op.id)!;
    expect(updated.provenance.confidence_score).toBeGreaterThan(0.5);
  });
});

describe("ReflectionEngine.tick — note_only effect", () => {
  it("emits a REFLECTION without touching the primary's confidence", async () => {
    const op = makeOpinion("alice", {
      content: "Some idle musing.",
      entity_ids: ["x"],
    });
    const noteReflector: Reflector = {
      reflect(): readonly ReflectionFinding[] {
        return [
          {
            kind: "consolidation",
            primary_asset_id: op.id,
            supporting_asset_ids: [],
            rationale: "Just noting it.",
            confidence: 0.5,
            effect: { type: "note_only" },
          },
        ];
      },
    };
    const h = harness(noteReflector);
    h.router.write(op);

    const before = h.router.read(op.id)!.provenance.confidence_score;
    const res = await h.engine.tick();
    expect(res.adjustedAssets).toBe(0);
    expect(res.outcomes.length).toBe(1);
    const after = h.router.read(op.id)!.provenance.confidence_score;
    expect(after).toBe(before);
  });
});

describe("ReflectionEngine — confidence clamping", () => {
  it("does not exceed maxConfidence", async () => {
    const op = makeOpinion("alice", {
      content: "near max",
      entity_ids: ["x"],
      provenance: ProvenanceSchema.parse({
        source_turn_id: "t1",
        confidence_score: 0.98,
        confidence_source: ConfidenceSource.INFERRED,
        raw_quote_anchors: [
          RawQuoteAnchorSchema.parse({ turn_id: "t1", quote: "near max" }),
        ],
        temporal_range: TemporalRangeSchema.parse({ turn_start: "t1" }),
      }),
    });
    const bigUp: Reflector = {
      reflect(): readonly ReflectionFinding[] {
        return [
          {
            kind: "corroboration",
            primary_asset_id: op.id,
            supporting_asset_ids: [],
            rationale: "all-in",
            confidence: 0.9,
            effect: { type: "adjust_confidence", delta: +0.5 },
          },
        ];
      },
    };
    const h = harness(bigUp);
    h.router.write(op);
    await h.engine.tick();
    const updated = h.router.read(op.id)!;
    expect(updated.provenance.confidence_score).toBeLessThanOrEqual(0.99);
  });

  it("does not fall below minConfidence", async () => {
    const op = makeOpinion("alice", {
      content: "near min",
      entity_ids: ["x"],
      provenance: ProvenanceSchema.parse({
        source_turn_id: "t1",
        confidence_score: 0.08,
        confidence_source: ConfidenceSource.INFERRED,
        raw_quote_anchors: [
          RawQuoteAnchorSchema.parse({ turn_id: "t1", quote: "near min" }),
        ],
        temporal_range: TemporalRangeSchema.parse({ turn_start: "t1" }),
      }),
    });
    const bigDown: Reflector = {
      reflect(): readonly ReflectionFinding[] {
        return [
          {
            kind: "contradiction",
            primary_asset_id: op.id,
            supporting_asset_ids: [],
            rationale: "all-down",
            confidence: 0.9,
            effect: { type: "adjust_confidence", delta: -0.5 },
          },
        ];
      },
    };
    const h = harness(bigDown);
    h.router.write(op);
    await h.engine.tick();
    const updated = h.router.read(op.id)!;
    expect(updated.provenance.confidence_score).toBeGreaterThanOrEqual(0.05);
  });
});
