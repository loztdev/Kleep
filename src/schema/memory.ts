/**
 * The base MemoryAsset model.
 *
 * Every stored item in Kleep — World Bible entry, Lore snippet,
 * summarized delta, reflection, opinion — is ultimately a MemoryAsset.
 * Specialized models (WorldBibleEntry, LoreSnippet) extend this base.
 */

import { z } from "zod";

import { newId } from "./ids";
import { Network, NetworkSchema } from "./networks";
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

/** String-literal union for the `MemoryKind` enum. */
export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

/** Zod validator for the `MemoryKind` enum. */
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
 *
 * `viewpoint_holder` is required iff `network === OPINION` — an opinion
 * is meaningless without knowing whose head it lives in. The constraint
 * is enforced on the consumer schemas via `withOpinionViewpointRule`.
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
    viewpoint_holder: z.string().min(1).optional(),
    last_updated_turn: TurnIdSchema.optional(),
    relevance: z.number().int().nonnegative().default(0),
  })
  .strict();

type AssetLike = {
  network: Network;
  viewpoint_holder?: string;
};

/**
 * Attach the OPINION ↔ viewpoint_holder coupling to a Zod schema.
 * Used by the public MemoryAssetSchema and LoreSnippetSchema, which
 * can both legitimately live in the OPINION network.
 */
export function withOpinionViewpointRule<S extends z.ZodTypeAny>(
  schema: S,
): z.ZodEffects<S, z.output<S>, z.input<S>> {
  return schema.superRefine((val: AssetLike, ctx) => {
    if (val.network === Network.OPINION && !val.viewpoint_holder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["viewpoint_holder"],
        message: "viewpoint_holder is required when network === OPINION",
      });
    }
    if (val.network !== Network.OPINION && val.viewpoint_holder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["viewpoint_holder"],
        message: "viewpoint_holder is only allowed when network === OPINION",
      });
    }
  });
}

/** Public schema for any non-entity, non-lore memory asset. */
export const MemoryAssetSchema = withOpinionViewpointRule(MemoryAssetBaseSchema);
/** Inferred TS type for a validated `MemoryAsset`. */
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
