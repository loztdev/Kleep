import { InMemoryStructuredStore } from "../../storage";
import { MemoryKind, Network } from "../../schema";
import { REMEMBER_FACT_TOOL_NAME, buildRememberFactTool } from "../rememberFact";

function makeCtx() {
  const structured = new InMemoryStructuredStore();
  return {
    structured,
    ctx: {
      structured,
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
