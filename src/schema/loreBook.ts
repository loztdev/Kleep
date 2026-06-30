/**
 * Lore Book snippets — descriptive prose for the vector side of storage.
 *
 * A LoreSnippet is the unit the embedding/retrieval pipeline (Tier 3.6)
 * will operate on. We don't compute embeddings here — that's the storage
 * layer's job — but we leave a slot so the schema is shape-stable.
 */

import { z } from "zod";

import {
  MemoryAssetBaseSchema,
  MemoryKind,
  withOpinionViewpointRule,
} from "./memory";

const LoreSnippetObjectSchema = MemoryAssetBaseSchema.extend({
  kind: z.literal(MemoryKind.LORE).default(MemoryKind.LORE),
  title: z.string().optional(),
  // Embeddings are populated by the vector store at write time; the
  // schema only holds them so a snippet round-trips losslessly.
  embedding: z.array(z.number()).optional(),
  embedding_model: z.string().optional(),
}).strict();

export const LoreSnippetSchema = withOpinionViewpointRule(
  LoreSnippetObjectSchema,
);

export type LoreSnippet = z.infer<typeof LoreSnippetSchema>;
