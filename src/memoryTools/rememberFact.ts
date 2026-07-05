/**
 * `remember_fact` — a tool the model can call to persist a durable fact
 * about the user, the world, or a character into the structured memory
 * store. Bridges the model's natural-language "please remember X" impulse
 * to `StructuredStore.put`, so telling the model "Remember my name is
 * Aaron" actually stores something the next chat can retrieve.
 *
 * Kept deliberately minimal: only `content` is required. `tags` and
 * `entity_ids` are optional hints. Everything else (`network`, provenance,
 * turn anchoring) is derived from the current conversation — the model
 * doesn't need to know how the memory graph is shaped, only what the
 * user asked it to remember.
 */

import { ConfidenceSource, MemoryKind, Network, newId } from "../schema";
import type { MemoryAsset } from "../schema";
import type { StructuredStore } from "../storage";
import type { ToolExecutionResult, ToolRegistration } from "./types";

export const REMEMBER_FACT_TOOL_NAME = "remember_fact";

/** Context the tool executor needs to attribute a written memory back to the
 * turn that triggered it — the current user message the model is responding
 * to. Same shape both providers use when threading tool-execution state. */
export interface MemoryToolContext {
  structured: StructuredStore;
  sourceTurnId: string;
  sourceQuote: string;
}

/** Build the `remember_fact` tool bound to `ctx`. Returns the JSON-schema
 * definition the model sees plus the executor `generateReply`'s loop calls
 * when the model invokes it. */
export function buildRememberFactTool(ctx: MemoryToolContext): ToolRegistration {
  return {
    definition: {
      name: REMEMBER_FACT_TOOL_NAME,
      description: [
        "Persist a durable fact about the user, the world, or a character so it survives across chats.",
        "Call this when the user explicitly asks you to remember something (e.g. \"remember my name is Aaron\"),",
        "or when the user reveals a stable fact you'd want to reference later (their preferences,",
        "a character's traits, world details). Do NOT call it for anything ephemeral, uncertain, or already stored.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The fact to remember, written as a single self-contained declarative sentence in the third person. E.g. \"The user's name is Aaron.\", not \"my name is Aaron\".",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Short freeform labels for browsing/filtering later — e.g. [\"name\", \"personal\"], [\"character\", \"dog\"], [\"world\", \"geography\"]. Optional.",
          },
          entity_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Ids of any related entities the memory should link to (e.g. [\"char:aaron\"]). Skip when unsure — leave blank rather than guessing.",
          },
        },
        required: ["content"],
      },
    },
    execute: async (input) => execute(input, ctx),
  };
}

/** Coerce whatever the model sent for an array-of-strings field into a
 * clean `string[]` — non-array inputs become `[]`, and non-string /
 * empty-string entries are dropped rather than stored as junk. */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
}

async function execute(rawInput: unknown, ctx: MemoryToolContext): Promise<ToolExecutionResult> {
  if (typeof rawInput !== "object" || rawInput === null) {
    return { content: "remember_fact expected an object; got something else. Nothing was stored.", isError: true };
  }
  const input = rawInput as {
    content?: unknown;
    tags?: unknown;
    entity_ids?: unknown;
  };
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) {
    return {
      content: "remember_fact requires a non-empty `content` string. Nothing was stored.",
      isError: true,
    };
  }
  const tags = toStringArray(input.tags);
  const entityIds = toStringArray(input.entity_ids);

  const asset: MemoryAsset = {
    id: newId(),
    // OBSERVATION: things directly stated by the user or observed in the
    // conversation. Model doesn't get to pick network — keeps the tool
    // schema tight and avoids the OPINION-viewpoint validator tripping.
    network: Network.OBSERVATION,
    kind: MemoryKind.FACT,
    content,
    entity_ids: entityIds,
    tags,
    relevance: 0,
    provenance: {
      source_turn_id: ctx.sourceTurnId,
      confidence_score: 1,
      // The user explicitly asked for this to be remembered — that's a
      // direct assertion, not the model inferring anything.
      confidence_source: ConfidenceSource.USER_ASSERTED,
      raw_quote_anchors: [
        {
          turn_id: ctx.sourceTurnId,
          quote: ctx.sourceQuote,
        },
      ],
      temporal_range: {
        // Anchor the range to the same turn the tool call came from, and
        // flag it as narratively always-true so retrieval doesn't scope it
        // to a specific scene window.
        turn_start: ctx.sourceTurnId,
        narrative_always: true,
      },
    },
  };
  ctx.structured.put(asset);
  return { content: `Remembered: ${content}` };
}
