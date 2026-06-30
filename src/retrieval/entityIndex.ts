/**
 * Entity-mention index — entity-graph channel of the fusion engine.
 *
 * Maintains a lookup from "any name a user might type" → entity_id.
 * Populated from each WorldBibleEntry's canonical_name + aliases.
 *
 * Two queries:
 *
 *   - `mentionsIn(text)`  returns the set of entity_ids the text appears
 *                         to mention. Word-boundary match on the
 *                         lowercased input; longest name wins on tie so
 *                         "Mojo Jojo" doesn't double-fire as "Mojo".
 *   - `idsForName(name)`  exact alias lookup; used by the extractor.
 */

import type { WorldBibleEntry } from "../schema";

/** Lookup from entity name/alias → entity_id, with word-bounded mention scanning. */
export class EntityIndex {
  /** lowercase name → entity_ids (Set, because aliases can collide) */
  private byName = new Map<string, Set<string>>();
  /** entity_id → all names currently registered for it */
  private byEntity = new Map<string, Set<string>>();

  /** Register an entity's canonical name + aliases. Re-add replaces. */
  add(entry: WorldBibleEntry): void {
    this.remove(entry.entity_id); // re-add is replace
    const names = new Set<string>([
      entry.canonical_name,
      ...entry.aliases,
    ]);
    this.byEntity.set(entry.entity_id, names);
    for (const n of names) {
      const key = n.toLowerCase();
      if (key.length === 0) continue;
      bucket(this.byName, key).add(entry.entity_id);
    }
  }

  /** Drop an entity from the index; returns false if unknown. */
  remove(entityId: string): boolean {
    const names = this.byEntity.get(entityId);
    if (!names) return false;
    this.byEntity.delete(entityId);
    for (const n of names) {
      const key = n.toLowerCase();
      const set = this.byName.get(key);
      if (set) {
        set.delete(entityId);
        if (set.size === 0) this.byName.delete(key);
      }
    }
    return true;
  }

  /** Number of registered entities. */
  size(): number {
    return this.byEntity.size;
  }

  /** Exact (case-insensitive) lookup — every entity that uses this name. */
  idsForName(name: string): readonly string[] {
    const set = this.byName.get(name.toLowerCase());
    return set ? [...set] : [];
  }

  /**
   * Scan a free-form string and return every entity_id whose
   * canonical name or alias appears as a word-bounded substring.
   *
   * Longest names are tried first so "Mojo Jojo" wins over "Mojo".
   * A single span of text can mention multiple entities, but we never
   * double-count the same entity from overlapping aliases.
   */
  mentionsIn(text: string): readonly string[] {
    if (this.byName.size === 0) return [];
    const lower = text.toLowerCase();
    const names = [...this.byName.keys()].sort((a, b) => b.length - a.length);
    const found = new Set<string>();
    const claimed: Array<[number, number]> = [];

    for (const name of names) {
      let from = 0;
      while (from <= lower.length) {
        const idx = lower.indexOf(name, from);
        if (idx < 0) break;
        const end = idx + name.length;
        if (isWordBounded(lower, idx, end) && !overlaps(claimed, idx, end)) {
          for (const id of this.byName.get(name)!) found.add(id);
          claimed.push([idx, end]);
        }
        from = idx + 1;
      }
    }
    return [...found];
  }
}

/** Lazy-init a Set bucket inside a Map. */
function bucket<K, V>(m: Map<K, Set<V>>, k: K): Set<V> {
  let s = m.get(k);
  if (!s) {
    s = new Set<V>();
    m.set(k, s);
  }
  return s;
}

/** True iff `[start, end)` in `s` is flanked by non-word characters. */
function isWordBounded(s: string, start: number, end: number): boolean {
  const before = start === 0 ? "" : s[start - 1]!;
  const after = end === s.length ? "" : s[end]!;
  return !isWordChar(before) && !isWordChar(after);
}

/** Treat a-z, 0-9, apostrophe, and hyphen as word characters. */
function isWordChar(c: string): boolean {
  if (c === "") return false;
  const code = c.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 97 && code <= 122) || // a-z (input is lowercased)
    c === "'" ||
    c === "-"
  );
}

/** True if `[a, b)` overlaps any previously-claimed `[start, end)` span. */
function overlaps(
  claimed: ReadonlyArray<[number, number]>,
  a: number,
  b: number,
): boolean {
  for (const [s, e] of claimed) {
    if (a < e && s < b) return true;
  }
  return false;
}
