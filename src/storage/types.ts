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

/**
 * Combined predicate accepted by `StructuredStore.query`. All supplied
 * fields are AND-ed together; omitted fields are wildcards.
 */
export interface StructuredQuery {
  network?: Network | readonly Network[];
  kind?: MemoryKind | readonly MemoryKind[];
  entity_id?: string;
  tag?: string;
  viewpoint_holder?: string;
}

/**
 * Persistence contract for structured assets (World Bible entries +
 * the FACT/RULE/SUMMARY/REFLECTION/OPINION buckets). Implementations:
 * `InMemoryStructuredStore` (this tier) and `expo-sqlite` (future).
 */
export interface StructuredStore {
  /** Insert or replace a structured memory asset. */
  put(asset: MemoryAsset): void;
  /** Insert or replace a full World Bible entry. */
  putEntry(entry: WorldBibleEntry): void;

  /** Fetch any stored asset by its id. */
  get(id: string): MemoryAsset | WorldBibleEntry | undefined;
  /** Fetch an entity card by its `entity_id`. */
  getEntry(entityId: string): WorldBibleEntry | undefined;

  /** Run a filter query and return matching assets, unordered. */
  query(filter: StructuredQuery): Array<MemoryAsset | WorldBibleEntry>;

  /** Remove an asset by id; returns true if it existed. */
  delete(id: string): boolean;

  /** Number of stored assets. */
  size(): number;
}

/**
 * Filter accepted by `VectorStore.query`. Same AND-then-wildcard
 * semantics as `StructuredQuery`.
 */
export interface VectorQueryFilter {
  network?: Network | readonly Network[];
  tag?: string;
  viewpoint_holder?: string;
}

/** One ranked hit from a vector query. */
export interface VectorSearchResult {
  snippet: LoreSnippet;
  /** Cosine similarity in [-1, 1] — higher is more similar. */
  score: number;
}

/**
 * Persistence contract for semantically-indexed `LoreSnippet`s.
 * Implementations: `InMemoryVectorStore` (this tier) and `sqlite-vec`
 * or a hosted vector DB (Tier 3.6+).
 */
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

  /** Remove a snippet by id; returns true if it existed. */
  delete(id: string): boolean;

  /** Number of stored snippets. */
  size(): number;

  /**
   * Every stored snippet matching `filter` (or all of them, with no
   * filter), unordered — no embedding required. For browsing the lore
   * book (Tier 7.5), not semantic search; `query()` is still the right
   * call for "what's relevant to this text".
   */
  list(filter?: VectorQueryFilter): LoreSnippet[];
}

/**
 * Two flavors of saved prompt:
 * - `persona` — the "who you're talking to" system prompt (the original kind).
 * - `jailbreak` — a permissioning/behavior-shaping prompt prepended *before*
 *   the persona so the persona doesn't have to also encode the permissions.
 * Same shape either way; `kind` is a flat marker the UI uses to split the
 * list into two views and lets a prompt be promoted/demoted between them
 * without losing history.
 */
export type SavedPromptKind = "persona" | "jailbreak";

/** A user-saved system prompt — plain app config, no provenance tracking needed. */
export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  kind: SavedPromptKind;
  createdAt: number;
  updatedAt: number;
}

/**
 * Persistence contract for user-saved system prompts (Tier 7.6). Unlike
 * `ChatSessionStore`, this has an in-memory fallback (`InMemoryPromptStore`)
 * so saved prompts still work for the length of a session on web, the
 * same way `structured`/`vector` do — only chat *history* is native-only.
 */
export interface PromptStore {
  /** Create a new saved prompt. `kind` defaults to `persona` when unset. */
  create(prompt: {
    id: string;
    title: string;
    content: string;
    kind?: SavedPromptKind;
    now: number;
  }): SavedPrompt;

  /** Every saved prompt, most-recently-updated first. Pass `kind` to filter to one flavor. */
  list(kind?: SavedPromptKind): SavedPrompt[];

  get(id: string): SavedPrompt | undefined;

  /** Update a prompt's title/content; bumps `updatedAt`. No-op if `id` is unknown. */
  update(id: string, fields: { title: string; content: string }, now: number): void;

  /**
   * Flip a prompt between `persona` and `jailbreak` without touching title/
   * content — the UI's "move to jailbreaks" / "move to personas" action.
   * Bumps `updatedAt` so the moved prompt jumps to the top of the target list.
   */
  setKind(id: string, kind: SavedPromptKind, now: number): void;

  /** Remove a prompt by id; returns true if it existed. */
  delete(id: string): boolean;
}
