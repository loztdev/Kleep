import {
  LoreSnippetSchema,
  MemoryAssetSchema,
  MemoryKind,
  Network,
  WorldBibleEntrySchema,
  newId,
  type LoreSnippet,
  type MemoryAsset,
  type WorldBibleEntry,
} from "../../schema";
import { makeProvenance } from "../../schema/__tests__/fixtures";

export function makeFact(
  overrides: Partial<MemoryAsset> = {},
): MemoryAsset {
  return MemoryAssetSchema.parse({
    id: newId(),
    network: Network.EXPERIENCE,
    kind: MemoryKind.FACT,
    content: "They met at the docks.",
    provenance: makeProvenance(),
    ...overrides,
  });
}

export function makeOpinion(
  viewpointHolder: string,
  overrides: Partial<MemoryAsset> = {},
): MemoryAsset {
  return MemoryAssetSchema.parse({
    id: newId(),
    network: Network.OPINION,
    kind: MemoryKind.OPINION,
    content: `${viewpointHolder} thinks the king is weak.`,
    provenance: makeProvenance(),
    viewpoint_holder: viewpointHolder,
    ...overrides,
  });
}

export function makeEntry(
  entityId: string,
  overrides: Partial<WorldBibleEntry> = {},
): WorldBibleEntry {
  return WorldBibleEntrySchema.parse({
    id: newId(),
    network: Network.WORLD,
    content: `${entityId} card`,
    provenance: makeProvenance(),
    entity_id: entityId,
    entity_type: "character",
    canonical_name: entityId,
    ...overrides,
  });
}

export function makeLore(
  embedding: readonly number[],
  overrides: Partial<LoreSnippet> = {},
): LoreSnippet {
  return LoreSnippetSchema.parse({
    id: newId(),
    network: Network.WORLD,
    content: "The desert hums at noon.",
    provenance: makeProvenance(),
    embedding: [...embedding],
    embedding_model: "stub-v1",
    ...overrides,
  });
}
