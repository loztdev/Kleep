/**
 * Tier 1.3: MemoryRouter.
 *
 * Single entry point for writing memory assets and reading them back.
 * The router:
 *
 *   1. Validates the (kind, network) pair against the isolation rules
 *      in `networkRules.ts`.
 *   2. Dispatches LoreSnippets to the VectorStore and everything else
 *      to the StructuredStore.
 *   3. Provides a `query()` helper that scopes reads to one or more
 *      networks so callers can ask "what does the WORLD say?" or
 *      "what does Alice believe?" without leaking opinions into hard
 *      facts (and vice versa).
 *
 * The router holds NO storage state of its own — it's pure dispatch on
 * top of the two stores.
 */

import {
  MemoryKind,
  type LoreSnippet,
  type MemoryAsset,
  type Network,
  type WorldBibleEntry,
} from "../schema";
import type {
  StructuredQuery,
  StructuredStore,
  VectorQueryFilter,
  VectorSearchResult,
  VectorStore,
} from "../storage";
import { assertAllowed } from "./networkRules";

export type AnyAsset = MemoryAsset | WorldBibleEntry | LoreSnippet;

function isLoreSnippet(asset: AnyAsset): asset is LoreSnippet {
  return asset.kind === MemoryKind.LORE;
}

function isWorldBibleEntry(asset: AnyAsset): asset is WorldBibleEntry {
  return (
    asset.kind === MemoryKind.ENTITY &&
    (asset as WorldBibleEntry).entity_id !== undefined
  );
}

export class MemoryRouter {
  constructor(
    private readonly structured: StructuredStore,
    private readonly vector: VectorStore,
  ) {}

  /**
   * Write `asset` to the correct backing store. Throws
   * `NetworkRuleViolation` if the (kind, network) pair is not allowed.
   * Throws if a LORE snippet arrives without an embedding.
   */
  write(asset: AnyAsset): void {
    assertAllowed(asset.kind as MemoryKind, asset.network as Network);

    if (isLoreSnippet(asset)) {
      this.vector.upsert(asset);
      return;
    }
    if (isWorldBibleEntry(asset)) {
      this.structured.putEntry(asset);
      return;
    }
    this.structured.put(asset as MemoryAsset);
  }

  /** Look up by id across both stores. Structured first, then vector. */
  read(id: string): AnyAsset | undefined {
    return this.structured.get(id) ?? this.vector.get(id);
  }

  /** Scoped structured query — same shape as `StructuredStore.query`. */
  query(filter: StructuredQuery): Array<MemoryAsset | WorldBibleEntry> {
    return this.structured.query(filter);
  }

  /**
   * Scoped semantic search. Same shape as `VectorStore.query`. Use the
   * `network` filter to keep opinion lore out of canonical-WORLD reads
   * and vice versa.
   */
  semanticQuery(
    embedding: readonly number[],
    topK: number,
    filter?: VectorQueryFilter,
  ): VectorSearchResult[] {
    return this.vector.query(embedding, topK, filter);
  }

  /** Delete by id from whichever store holds it. Returns true if removed. */
  delete(id: string): boolean {
    return this.structured.delete(id) || this.vector.delete(id);
  }
}
