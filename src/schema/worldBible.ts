/**
 * World Bible entries — structured, canonical facts.
 *
 * These land in the structured/graph store (Tier 1.2). One entry == one
 * entity; attributes are typed key/value pairs that each carry their own
 * provenance so individual claims about an entity can be traced,
 * updated, or retracted independently.
 */

import { z } from "zod";

import { MemoryAssetBaseSchema, MemoryKind } from "./memory";
import { Network } from "./networks";
import { ProvenanceSchema } from "./provenance";

/**
 * A single typed claim about an entity (e.g. species = "Pomeranian").
 *
 * The per-attribute provenance is the whole point: when the dedup engine
 * (Tier 2.5) sees a conflict, it can compare confidence/temporal_range
 * on the individual attribute, not the whole entity card.
 */
export const WorldBibleAttributeSchema = z
  .object({
    key: z.string().min(1),
    value: z.unknown(),
    provenance: ProvenanceSchema,
  })
  .strict();

export type WorldBibleAttribute = z.infer<typeof WorldBibleAttributeSchema>;

/**
 * A canonical entity card. Forced into the WORLD or OBSERVATION network —
 * Opinion/Experience aren't appropriate routings for hard entity facts.
 */
export const WorldBibleEntrySchema = MemoryAssetBaseSchema.extend({
  kind: z.literal(MemoryKind.ENTITY).default(MemoryKind.ENTITY),
  entity_id: z.string().min(1),
  entity_type: z.string().min(1),
  canonical_name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  attributes: z.array(WorldBibleAttributeSchema).default([]),
  summary: z.string().optional(),
})
  .strict()
  .superRefine((val, ctx) => {
    if (val.network !== Network.WORLD && val.network !== Network.OBSERVATION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["network"],
        message:
          "WorldBibleEntry must live in the WORLD or OBSERVATION network",
      });
    }
  });

export type WorldBibleEntry = z.infer<typeof WorldBibleEntrySchema>;

export function getAttribute(
  entry: WorldBibleEntry,
  key: string,
): WorldBibleAttribute | undefined {
  return entry.attributes.find((a) => a.key === key);
}
