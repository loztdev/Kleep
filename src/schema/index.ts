/**
 * Provenance-first data schema for every memory asset Kleep stores.
 *
 * Tier 1.1 of the backlog: every data point is born with tracking
 * metadata (`source_turn_id`, `confidence_score`, `raw_quote_anchors`,
 * `temporal_range`) so the rest of the system can trace, score, and
 * time-bound any fact later.
 */

export { newId } from "./ids";
export { Network, NetworkSchema } from "./networks";
export {
  ConfidenceSource,
  ConfidenceSourceSchema,
  ProvenanceSchema,
  RawQuoteAnchorSchema,
  TemporalRangeSchema,
  TurnIdSchema,
} from "./provenance";
export type {
  Provenance,
  RawQuoteAnchor,
  TemporalRange,
  TurnId,
} from "./provenance";
export {
  MemoryAssetBaseSchema,
  MemoryAssetSchema,
  MemoryKind,
  MemoryKindSchema,
  withOpinionViewpointRule,
  withRelevance,
} from "./memory";
export type { MemoryAsset } from "./memory";
export {
  WorldBibleAttributeSchema,
  WorldBibleEntrySchema,
  getAttribute,
} from "./worldBible";
export type {
  WorldBibleAttribute,
  WorldBibleEntry,
} from "./worldBible";
export { LoreSnippetSchema } from "./loreBook";
export type { LoreSnippet } from "./loreBook";
