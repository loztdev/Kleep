/**
 * In-memory reference implementation of `StructuredStore`.
 *
 * Backed by a single `Map<id, asset>` plus secondary indexes for the
 * filters Tier 1 + Tier 2 actually use (network, kind, entity_id, tag,
 * viewpoint_holder). When `expo-sqlite` lands for production, this same
 * interface is the contract — only the implementation swaps.
 */

import type {
  MemoryAsset,
  MemoryKind,
  Network,
  WorldBibleEntry,
} from "../schema";
import type {
  StructuredQuery,
  StructuredStore,
} from "./types";

type Stored = MemoryAsset | WorldBibleEntry;

function isWorldBibleEntry(asset: Stored): asset is WorldBibleEntry {
  return (asset as WorldBibleEntry).entity_id !== undefined;
}

function asArray<T>(v: T | readonly T[] | undefined): readonly T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? (v as readonly T[]) : ([v as T] as const);
}

export class InMemoryStructuredStore implements StructuredStore {
  private byId = new Map<string, Stored>();
  private byEntityId = new Map<string, WorldBibleEntry>();
  private byNetwork = new Map<Network, Set<string>>();
  private byKind = new Map<MemoryKind, Set<string>>();
  private byTag = new Map<string, Set<string>>();
  private byViewpoint = new Map<string, Set<string>>();

  put(asset: MemoryAsset): void {
    this.replace(asset);
  }

  putEntry(entry: WorldBibleEntry): void {
    this.replace(entry);
    this.byEntityId.set(entry.entity_id, entry);
  }

  get(id: string): Stored | undefined {
    return this.byId.get(id);
  }

  getEntry(entityId: string): WorldBibleEntry | undefined {
    return this.byEntityId.get(entityId);
  }

  query(filter: StructuredQuery): Stored[] {
    const candidates = this.candidates(filter);
    if (candidates === null) return [];

    const networks = asArray(filter.network);
    const kinds = asArray(filter.kind);

    const results: Stored[] = [];
    for (const id of candidates) {
      const asset = this.byId.get(id);
      if (!asset) continue;
      if (networks && !networks.includes(asset.network)) continue;
      if (kinds && !kinds.includes(asset.kind as MemoryKind)) continue;
      if (filter.entity_id !== undefined) {
        if (!this.matchesEntity(asset, filter.entity_id)) continue;
      }
      if (filter.tag !== undefined && !asset.tags.includes(filter.tag)) {
        continue;
      }
      if (
        filter.viewpoint_holder !== undefined &&
        asset.viewpoint_holder !== filter.viewpoint_holder
      ) {
        continue;
      }
      results.push(asset);
    }
    return results;
  }

  delete(id: string): boolean {
    const existing = this.byId.get(id);
    if (!existing) return false;
    this.unindex(existing);
    this.byId.delete(id);
    if (isWorldBibleEntry(existing)) {
      this.byEntityId.delete(existing.entity_id);
    }
    return true;
  }

  size(): number {
    return this.byId.size;
  }

  // ---- internals -------------------------------------------------------

  private replace(asset: Stored): void {
    const existing = this.byId.get(asset.id);
    if (existing) this.unindex(existing);
    this.byId.set(asset.id, asset);
    this.index(asset);
  }

  private index(asset: Stored): void {
    bucket(this.byNetwork, asset.network).add(asset.id);
    bucket(this.byKind, asset.kind as MemoryKind).add(asset.id);
    for (const tag of asset.tags) {
      bucket(this.byTag, tag).add(asset.id);
    }
    if (asset.viewpoint_holder) {
      bucket(this.byViewpoint, asset.viewpoint_holder).add(asset.id);
    }
  }

  private unindex(asset: Stored): void {
    discard(this.byNetwork.get(asset.network), asset.id);
    discard(this.byKind.get(asset.kind as MemoryKind), asset.id);
    for (const tag of asset.tags) discard(this.byTag.get(tag), asset.id);
    if (asset.viewpoint_holder) {
      discard(this.byViewpoint.get(asset.viewpoint_holder), asset.id);
    }
  }

  /**
   * Smallest candidate set we can derive from the filter — picks the
   * narrowest index available. Returns null when an index lookup proves
   * the result is empty.
   */
  private candidates(filter: StructuredQuery): Iterable<string> | null {
    const sets: Array<Set<string> | undefined> = [];

    if (filter.entity_id !== undefined) {
      const entry = this.byEntityId.get(filter.entity_id);
      if (!entry) return null;
      return [entry.id];
    }
    if (filter.tag !== undefined) sets.push(this.byTag.get(filter.tag));
    if (filter.viewpoint_holder !== undefined) {
      sets.push(this.byViewpoint.get(filter.viewpoint_holder));
    }
    const networks = asArray(filter.network);
    if (networks?.length === 1) sets.push(this.byNetwork.get(networks[0]!));
    const kinds = asArray(filter.kind);
    if (kinds?.length === 1) sets.push(this.byKind.get(kinds[0]!));

    const populated = sets.filter((s): s is Set<string> => !!s);
    if (sets.length > 0 && populated.length < sets.length) return null;
    if (populated.length === 0) return this.byId.keys();
    populated.sort((a, b) => a.size - b.size);
    return populated[0]!;
  }

  private matchesEntity(asset: Stored, entityId: string): boolean {
    if (isWorldBibleEntry(asset) && asset.entity_id === entityId) return true;
    return asset.entity_ids.includes(entityId);
  }
}

function bucket<K, V>(m: Map<K, Set<V>>, k: K): Set<V> {
  let s = m.get(k);
  if (!s) {
    s = new Set<V>();
    m.set(k, s);
  }
  return s;
}

function discard<V>(s: Set<V> | undefined, v: V): void {
  if (s) s.delete(v);
}
