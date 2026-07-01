/**
 * Structured-output helper: Zod schema → tool-call definition.
 *
 * Provider-agnostic — the JSON Schema a tool's parameters/`input_schema`
 * needs is the same shape whether the caller is `ClaudeClient.structured()`
 * (Anthropic tool-call schema) or `OpenRouterClient.structured()` (OpenAI
 * function-calling `parameters`). Converts the subset of Zod node types
 * Kleep's prompts actually need (object, string, number, boolean, literal,
 * enum, array, record, union, optional, nullable, default, refinements via
 * ZodEffects) — anything outside that subset throws rather than silently
 * producing a schema the model can't be validated against.
 */

import type { z } from "zod";

/** The JSON-schema shape a tool definition's parameters/`input_schema` requires for an object schema. */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
  [key: string]: unknown;
}

/** Convert a top-level `z.object()` schema into a tool input schema. Throws if the root isn't an object. */
export function zodToToolInputSchema(schema: z.ZodTypeAny): ToolInputSchema {
  const node = convert(schema);
  if (node.type !== "object") {
    throw new Error("zodToToolInputSchema requires a top-level z.object() schema");
  }
  return node as unknown as ToolInputSchema;
}

// Zod v3 keeps its schema internals on `_def` with no public typed accessor
// for arbitrary node shapes, so this helper centralizes the `any` escape.
function def(schema: z.ZodTypeAny): any {
  return (schema as any)._def;
}

function convert(schema: z.ZodTypeAny): Record<string, unknown> {
  const d = def(schema);
  const node = convertByType(schema, d);
  if (typeof schema.description === "string") {
    node.description = schema.description;
  }
  return node;
}

function convertByType(schema: z.ZodTypeAny, d: ReturnType<typeof def>): Record<string, unknown> {
  switch (d.typeName as string) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral":
      return { const: d.value };
    case "ZodEnum":
      return { type: "string", enum: [...d.values] };
    case "ZodNativeEnum": {
      const values = Object.values(d.values) as unknown[];
      if (values.every((v) => typeof v === "string")) return { type: "string", enum: values };
      if (values.every((v) => typeof v === "number")) return { type: "number", enum: values };
      return { enum: values };
    }
    case "ZodArray":
      return { type: "array", items: convert(d.type) };
    case "ZodRecord":
      return { type: "object", additionalProperties: convert(d.valueType) };
    case "ZodUnion":
      return { anyOf: d.options.map((opt: z.ZodTypeAny) => convert(opt)) };
    case "ZodOptional":
    case "ZodDefault":
      return convert(d.innerType);
    case "ZodNullable":
      return { anyOf: [convert(d.innerType), { type: "null" }] };
    case "ZodEffects":
      // Refinements/transforms (.superRefine(), .refine(), .transform())
      // aren't representable in JSON Schema — convert the inner shape and
      // let our own `schema.safeParse()` re-enforce the refinement on the
      // way back from the model (see ClaudeClient.structured / OpenRouterClient.structured).
      return convert(d.schema);
    case "ZodObject": {
      const shape = d.shape() as Record<string, z.ZodTypeAny>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convert(value);
        if (!isOptional(value)) required.push(key);
      }
      return { type: "object", properties, required, additionalProperties: false };
    }
    default:
      throw new Error(`zodToToolInputSchema: unsupported zod type "${d.typeName}"`);
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = def(schema).typeName as string;
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}
