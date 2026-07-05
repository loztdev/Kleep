import type { AnyAsset, IngestOutcome, IngestSink } from "../../ingest";
import { InMemoryStructuredStore } from "../../storage";
import { MemoryKind, Network } from "../../schema";
import { REMEMBER_FACT_TOOL_NAME, buildRememberFactTool } from "../rememberFact";

/** Minimal sink that just writes through to a structured store — the tool
 * doesn't care about dedup or indexing at unit-test level, but the
 * production wiring routes writes through a full `IngestSink` chain. */
function makeSink(structured: InMemoryStructuredStore): IngestSink {
  return {
    ingest(asset: AnyAsset): IngestOutcome {
      structured.put(asset as Parameters<typeof structured.put>[0]);
      return { kind: "created", asset };
    },
  };
}

function makeCtx() {
  const structured = new InMemoryStructuredStore();
  const sink = makeSink(structured);
  return {
    structured,
    ctx: {
      sink,
      sourceTurnId: "turn_1",
      sourceQuote: "Remember my name is Aaron.",
    },
  };
}

describe("remember_fact tool", () => {
  it("registers under the canonical name with an object input schema", () => {
    const { ctx } = makeCtx();
    const { definition } = buildRememberFactTool(ctx);
    expect(definition.name).toBe(REMEMBER_FACT_TOOL_NAME);
    expect(definition.inputSchema).toMatchObject({ type: "object" });
  });

  it("writes a FACT to the structured store when given a valid content string", async () => {
    const { structured, ctx } = makeCtx();
    const { execute } = buildRememberFactTool(ctx);

    const result = await execute({ content: "The user's name is Aaron.", tags: ["name"] });

    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/Remembered/);

    const stored = structured.query({ kind: MemoryKind.FACT });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: MemoryKind.FACT,
      network: Network.OBSERVATION,
      content: "The user's name is Aaron.",
      tags: ["name"],
    });
  });

  it("anchors provenance to the triggering user turn (source_turn_id + raw_quote_anchors)", async () => {
    // Whole point of `MemoryToolContext` is that a fact traces back to the
    // user turn that caused it — provenance is what makes a stored FACT
    // more than a floating string. Regression here would silently break
    // the memory-retrieval story.
    const { structured, ctx } = makeCtx();
    const { execute } = buildRememberFactTool(ctx);

    await execute({ content: "The user's name is Aaron." });

    const stored = structured.query({ kind: MemoryKind.FACT });
    expect(stored[0]!.provenance).toMatchObject({
      source_turn_id: "turn_1",
      raw_quote_anchors: [{ turn_id: "turn_1", quote: "Remember my name is Aaron." }],
    });
    expect(stored[0]!.provenance.temporal_range).toMatchObject({
      turn_start: "turn_1",
      narrative_always: true,
    });
  });

  it("filters non-string / empty entity_ids rather than storing them", async () => {
    const { structured, ctx } = makeCtx();
    const { execute } = buildRememberFactTool(ctx);

    await execute({
      content: "The dog belongs to char:aaron.",
      entity_ids: ["char:aaron", "", 42, null, "char:mojo"],
    });

    const stored = structured.query({ kind: MemoryKind.FACT });
    expect(stored[0]).toMatchObject({ entity_ids: ["char:aaron", "char:mojo"] });
  });

  it("returns an error result (does not write) when content is missing", async () => {
    const { structured, ctx } = makeCtx();
    const { execute } = buildRememberFactTool(ctx);

    const result = await execute({ tags: ["name"] });

    expect(result.isError).toBe(true);
    expect(structured.query({ kind: MemoryKind.FACT })).toHaveLength(0);
  });

  it("returns an error result when content is an empty string", async () => {
    const { structured, ctx } = makeCtx();
    const { execute } = buildRememberFactTool(ctx);

    const result = await execute({ content: "   " });

    expect(result.isError).toBe(true);
    expect(structured.query({ kind: MemoryKind.FACT })).toHaveLength(0);
  });

  it("returns an error result when the input isn't an object at all", async () => {
    const { ctx } = makeCtx();
    const { execute } = buildRememberFactTool(ctx);
    const result = await execute("just a string");
    expect(result.isError).toBe(true);
  });

  it("filters non-string / empty tags rather than storing them", async () => {
    const { structured, ctx } = makeCtx();
    const { execute } = buildRememberFactTool(ctx);

    await execute({
      content: "The user has a dog named Mojo.",
      tags: ["character", "", 42, null, "dog"],
    });

    const stored = structured.query({ kind: MemoryKind.FACT });
    expect(stored[0]).toMatchObject({ tags: ["character", "dog"] });
  });
});
