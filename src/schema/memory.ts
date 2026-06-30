/**
 * The base MemoryAsset model.
 *
 * Every stored item in Kleep — World Bible entry, Lore snippet,
 * summarized delta, reflection, opinion — is ultimately a MemoryAsset.
 * Specialized models (WorldBibleEntry, LoreSnippet) extend this base.
 */

import { z } from "zod";

import { newId } from "./ids";
import { NetworkSchema } from "./networks";
import { ProvenanceSchema, TurnIdSchema } from "./provenance";

/**
 * High-level routing label. Tier 1.2 (storage setup) uses this to decide
 * which engine receives the asset: structured/graph for FACT/ENTITY/RULE,
 * vector for LORE, either for SUMMARY/REFLECTION depending on shape.
 */
export const MemoryKind = {
  FACT: "fact",
  ENTITY: "entity",
  RULE: "rule",
  LORE: "lore",
  SUMMARY: "summary",
  REFLECTION: "reflection",
  OPINION: "opinion",
} as const;

export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

export const MemoryKindSchema = z.enum([
  MemoryKind.FACT,
  MemoryKind.ENTITY,
  MemoryKind.RULE,
  MemoryKind.LORE,
  MemoryKind.SUMMARY,
  MemoryKind.REFLECTION,
  MemoryKind.OPINION,
]);

/**
 * Shared fields every persisted memory carries. Strict-mode object so
 * extra properties are rejected.
 */
export const MemoryAssetBaseSchema = z
  .object({
    id: z.string().min(1).default(newId),
    network: NetworkSchema,
    kind: MemoryKindSchema,
    content: z.string().min(1),
    provenance: ProvenanceSchema,
    entity_ids: z.array(z.string().min(1)).default([]),
    tags: z.array(z.string().min(1)).default([]),
    last_updated_turn: TurnIdSchema.optional(),
    relevance: z.number().int().nonnegative().default(0),
  })
  .strict();

export const MemoryAssetSchema = MemoryAssetBaseSchema;
export type MemoryAsset = z.infer<typeof MemoryAssetSchema>;

/**
 * Return a copy of `asset` with relevance incremented by `delta`,
 * floored at zero. Pure — does not mutate input.
 */
export function withRelevance<T extends MemoryAsset>(
  asset: T,
  delta: number,
): T {
  return { ...asset, relevance: Math.max(0, asset.relevance + delta) };
}
