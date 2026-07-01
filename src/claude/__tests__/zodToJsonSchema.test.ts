import { z } from "zod";
import { zodToToolInputSchema } from "../zodToJsonSchema";

describe("zodToToolInputSchema", () => {
  it("converts primitives, optional, nullable, array, enum, and literal fields", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
      active: z.boolean(),
      kind: z.enum(["a", "b", "c"]),
      tag: z.literal("fixed"),
      nickname: z.string().nullable(),
      scores: z.array(z.number()),
    });

    const result = zodToToolInputSchema(schema);

    expect(result).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["name", "active", "kind", "tag", "nickname", "scores"],
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        active: { type: "boolean" },
        kind: { type: "string", enum: ["a", "b", "c"] },
        tag: { const: "fixed" },
        nickname: { anyOf: [{ type: "string" }, { type: "null" }] },
        scores: { type: "array", items: { type: "number" } },
      },
    });
  });

  it("supports nested objects and records", () => {
    const schema = z.object({
      attrs: z.record(z.string()),
      nested: z.object({ x: z.number() }),
    });

    const result = zodToToolInputSchema(schema);

    expect(result.properties.attrs).toEqual({ type: "object", additionalProperties: { type: "string" } });
    expect(result.properties.nested).toEqual({
      type: "object",
      properties: { x: { type: "number" } },
      required: ["x"],
      additionalProperties: false,
    });
  });

  it("carries .describe() text through as a description", () => {
    const schema = z.object({
      quote: z.string().describe("verbatim source text"),
    });

    const result = zodToToolInputSchema(schema);

    expect(result.properties.quote).toMatchObject({ type: "string", description: "verbatim source text" });
  });

  it("throws when the top-level schema isn't an object", () => {
    expect(() => zodToToolInputSchema(z.string())).toThrow(/top-level z.object/);
  });

  it("throws on an unsupported zod type", () => {
    const schema = z.object({ when: z.date() });
    expect(() => zodToToolInputSchema(schema)).toThrow(/unsupported zod type/);
  });

  it("unwraps .superRefine()/.refine() (ZodEffects) to the inner shape", () => {
    const schema = z
      .object({
        network: z.enum(["world", "observation", "opinion"]),
        viewpoint_holder: z.string().optional(),
      })
      .superRefine((val, ctx) => {
        if (val.network === "opinion" && !val.viewpoint_holder) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "required" });
        }
      });

    const result = zodToToolInputSchema(schema);

    expect(result).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["network"],
      properties: {
        network: { type: "string", enum: ["world", "observation", "opinion"] },
        viewpoint_holder: { type: "string" },
      },
    });
    // The refinement itself still runs on .safeParse() even though the
    // JSON-schema conversion can't represent it.
    expect(schema.safeParse({ network: "opinion" }).success).toBe(false);
    expect(schema.safeParse({ network: "opinion", viewpoint_holder: "Alice" }).success).toBe(true);
  });

  it("does not mark a field-level .optional().refine() as required", () => {
    const schema = z.object({
      name: z.string(),
      nickname: z
        .string()
        .optional()
        .refine((v) => v === undefined || v.length > 0, "must not be blank"),
    });

    const result = zodToToolInputSchema(schema);

    expect(result.required).toEqual(["name"]);
    expect(result.properties.nickname).toEqual({ type: "string" });
  });

  it("converts a string-valued native enum with a type field", () => {
    enum Color {
      Red = "red",
      Blue = "blue",
    }
    const schema = z.object({ color: z.nativeEnum(Color) });

    const result = zodToToolInputSchema(schema);

    expect(result.properties.color).toEqual({ type: "string", enum: ["red", "blue"] });
  });
});
