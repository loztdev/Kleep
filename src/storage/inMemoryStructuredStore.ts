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

/** In-memory `StructuredStore` reference impl, indexed for the Tier 1+2 filters. */
export class InMemoryStructuredStore implements StructuredStore {
  private byId = new Map<string, Stored>();
  private byEntityId = new Map<string, WorldBibleEntry>();
  private byNetwork = new Map<Network, Set<string>>();
  private byKind = new Map<MemoryKind, Set<string>>();
  private byTag = new Map<string, Set<string>>();
  private byViewpoint = new Map<string, Set<string>>();
  /**
   * Reverse index for entity references — populated from BOTH a
   * WorldBibleEntry's own `entity_id` AND any asset's `entity_ids`
   * array, so query({ entity_id }) finds the entity card and every
   * fact that mentions it.
   */
  private byEntityRef = new Map<string, Set<string>>();

  /** Insert or replace any structured memory asset by id. */
  put(asset: MemoryAsset): void {
    this.replace(asset);
  }

  /** Insert or replace a World Bible entry and update the entity index. */
  putEntry(entry: WorldBibleEntry): void {
    this.replace(entry);
    this.byEntityId.set(entry.entity_id, entry);
  }

  /** Look up any stored asset by its id. */
  get(id: string): Stored | undefined {
    return this.byId.get(id);
  }

  /** Look up an entity card by its `entity_id` (not the asset id). */
  getEntry(entityId: string): WorldBibleEntry | undefined {
    return this.byEntityId.get(entityId);
  }

  /**
   * Filter assets by any combination of network, kind, entity_id, tag,
   * and viewpoint_holder. Uses the smallest available index as the
   * candidate set before scanning.
   */
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

  /** Remove an asset (and its index entries) by id. */
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

  /** Total number of stored assets. */
  size(): number {
    return this.byId.size;
  }

  // ---- internals -------------------------------------------------------

  /** Overwrite an asset by id, fully re-indexing if it existed before. */
  private replace(asset: Stored): void {
    const existing = this.byId.get(asset.id);
    if (existing) this.unindex(existing);
    this.byId.set(asset.id, asset);
    this.index(asset);
  }

  /** Add this asset's id to every secondary index that applies. */
  private index(asset: Stored): void {
    bucket(this.byNetwork, asset.network).add(asset.id);
    bucket(this.byKind, asset.kind as MemoryKind).add(asset.id);
    for (const tag of asset.tags) {
      bucket(this.byTag, tag).add(asset.id);
    }
    if (asset.viewpoint_holder) {
      bucket(this.byViewpoint, asset.viewpoint_holder).add(asset.id);
    }
    for (const ref of this.entityRefs(asset)) {
      bucket(this.byEntityRef, ref).add(asset.id);
    }
  }

  /** Inverse of `index()` — removes this asset's id from every index. */
  private unindex(asset: Stored): void {
    discard(this.byNetwork.get(asset.network), asset.id);
    discard(this.byKind.get(asset.kind as MemoryKind), asset.id);
    for (const tag of asset.tags) discard(this.byTag.get(tag), asset.id);
    if (asset.viewpoint_holder) {
      discard(this.byViewpoint.get(asset.viewpoint_holder), asset.id);
    }
    for (const ref of this.entityRefs(asset)) {
      discard(this.byEntityRef.get(ref), asset.id);
    }
  }

  /** Union of an asset's `entity_ids` and (if an entry) its `entity_id`. */
  private entityRefs(asset: Stored): Set<string> {
    const refs = new Set<string>(asset.entity_ids);
    if (isWorldBibleEntry(asset)) refs.add(asset.entity_id);
    return refs;
  }

  /**
   * Smallest candidate set we can derive from the filter — picks the
   * narrowest index available. Returns null when an index lookup proves
   * the result is empty.
   */
  private candidates(filter: StructuredQuery): Iterable<string> | null {
    const sets: Array<Set<string> | undefined> = [];

    if (filter.entity_id !== undefined) {
      // Use the union index so both the entity card AND any asset that
      // references the entity via entity_ids are surfaced.
      sets.push(this.byEntityRef.get(filter.entity_id));
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

  /** True if this asset is the entity card for, or references, `entityId`. */
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
