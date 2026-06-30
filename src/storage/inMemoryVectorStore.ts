/**
 * In-memory reference implementation of `VectorStore`.
 *
 * Cosine similarity over a linear scan. Fine for fixture/test sizes;
 * Tier 3.6 will replace this with `sqlite-vec` or a hosted vector DB
 * behind the same interface.
 */

import type { LoreSnippet, Network } from "../schema";
import type {
  VectorQueryFilter,
  VectorSearchResult,
  VectorStore,
} from "./types";

function asArray<T>(v: T | readonly T[] | undefined): readonly T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? (v as readonly T[]) : ([v as T] as const);
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `embedding dimensionality mismatch: ${a.length} vs ${b.length}`,
    );
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class InMemoryVectorStore implements VectorStore {
  private byId = new Map<string, LoreSnippet>();
  private dim: number | null = null;

  upsert(snippet: LoreSnippet): void {
    if (!snippet.embedding || snippet.embedding.length === 0) {
      throw new Error(
        `LoreSnippet ${snippet.id} cannot be upserted without an embedding`,
      );
    }
    if (this.dim === null) {
      this.dim = snippet.embedding.length;
    } else if (snippet.embedding.length !== this.dim) {
      throw new Error(
        `embedding dim ${snippet.embedding.length} does not match store dim ${this.dim}`,
      );
    }
    this.byId.set(snippet.id, snippet);
  }

  get(id: string): LoreSnippet | undefined {
    return this.byId.get(id);
  }

  query(
    embedding: readonly number[],
    topK: number,
    filter?: VectorQueryFilter,
  ): VectorSearchResult[] {
    if (topK <= 0) return [];
    if (this.byId.size === 0) return [];
    if (this.dim !== null && embedding.length !== this.dim) {
      throw new Error(
        `query embedding dim ${embedding.length} does not match store dim ${this.dim}`,
      );
    }

    const networks = asArray(filter?.network);

    const scored: VectorSearchResult[] = [];
    for (const snippet of this.byId.values()) {
      if (networks && !networks.includes(snippet.network as Network)) continue;
      if (filter?.tag !== undefined && !snippet.tags.includes(filter.tag)) {
        continue;
      }
      if (
        filter?.viewpoint_holder !== undefined &&
        snippet.viewpoint_holder !== filter.viewpoint_holder
      ) {
        continue;
      }
      scored.push({ snippet, score: cosine(embedding, snippet.embedding!) });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  delete(id: string): boolean {
    return this.byId.delete(id);
  }

  size(): number {
    return this.byId.size;
  }
}
