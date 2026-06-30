/**
 * Tier 1.2: Dual-Engine Storage interfaces.
 *
 * Two stores live behind the MemoryRouter (Tier 1.3):
 *
 * - `StructuredStore` keeps the strict, queryable bits — World Bible
 *   entries, the 4-network buckets of FACT / RULE / SUMMARY /
 *   REFLECTION / ENTITY / OPINION. Lookups are by id / entity_id /
 *   network / kind / tag.
 * - `VectorStore` keeps Lore snippets and serves semantic top-K
 *   queries over their embeddings.
 *
 * The interfaces are deliberately minimal — Tier 2 (ingestion) and
 * Tier 3 (retrieval) will add specialized read paths. Anything not
 * needed yet is left out so we don't lock in a wrong shape.
 *
 * In-memory reference implementations live next to the interface
 * (`InMemoryStructuredStore`, `InMemoryVectorStore`). A real `expo-
 * sqlite` implementation can land alongside Tier 2 without touching the
 * router or any callers.
 */

import type {
  LoreSnippet,
  MemoryAsset,
  MemoryKind,
  Network,
  WorldBibleEntry,
} from "../schema";

export interface StructuredQuery {
  network?: Network | readonly Network[];
  kind?: MemoryKind | readonly MemoryKind[];
  entity_id?: string;
  tag?: string;
  viewpoint_holder?: string;
}

export interface StructuredStore {
  /** Insert or replace a structured memory asset. */
  put(asset: MemoryAsset): void;
  /** Insert or replace a full World Bible entry. */
  putEntry(entry: WorldBibleEntry): void;

  get(id: string): MemoryAsset | WorldBibleEntry | undefined;
  getEntry(entityId: string): WorldBibleEntry | undefined;

  query(filter: StructuredQuery): Array<MemoryAsset | WorldBibleEntry>;

  delete(id: string): boolean;

  size(): number;
}

export interface VectorQueryFilter {
  network?: Network | readonly Network[];
  tag?: string;
  viewpoint_holder?: string;
}

export interface VectorSearchResult {
  snippet: LoreSnippet;
  /** Cosine similarity in [-1, 1] — higher is more similar. */
  score: number;
}

export interface VectorStore {
  /**
   * Insert or replace a lore snippet. Requires `snippet.embedding` to
   * be populated; the store doesn't compute embeddings itself.
   */
  upsert(snippet: LoreSnippet): void;

  get(id: string): LoreSnippet | undefined;

  /**
   * Top-K semantic search. `embedding` must be the same dimensionality
   * as the stored vectors; the store enforces this at query time.
   */
  query(
    embedding: readonly number[],
    topK: number,
    filter?: VectorQueryFilter,
  ): VectorSearchResult[];

  delete(id: string): boolean;

  size(): number;
}
