/**
 * SQLite-backed `StructuredStore` (Tier 6.1) — same contract as
 * `InMemoryStructuredStore`, verified against the identical contract test
 * suite (see `__tests__/structuredStore.contract.ts`), just durable.
 *
 * One wide table (`structured_assets`) with the full validated asset
 * stored as a JSON `data` column (source of truth — round-trips
 * provenance losslessly for the Why UI) plus indexed scalar columns
 * (network/kind/viewpoint_holder/entity_id_self) and two junction tables
 * (entity refs, tags) for the filters `query()` needs. SQLite's own query
 * planner picks the join order; unlike the in-memory impl, there's no
 * need to hand-pick "the smallest index" — that's what the DB is for.
 */

import type { MemoryAsset, Network, WorldBibleEntry } from "../schema";
import type { SqlDatabase } from "./sql/types";
import type { StructuredQuery, StructuredStore } from "./types";

type Stored = MemoryAsset | WorldBibleEntry;

interface Row {
  id: string;
  data: string;
}

function isWorldBibleEntry(asset: Stored): asset is WorldBibleEntry {
  return (asset as WorldBibleEntry).entity_id !== undefined;
}

function asArray<T>(v: T | readonly T[] | undefined): readonly T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? (v as readonly T[]) : ([v as T] as const);
}

/** SQLite `StructuredStore` — durable, same contract as the in-memory reference impl. */
export class SqliteStructuredStore implements StructuredStore {
  constructor(private readonly db: SqlDatabase) {}

  put(asset: MemoryAsset): void {
    this.upsertRow(asset, null);
  }

  putEntry(entry: WorldBibleEntry): void {
    this.upsertRow(entry, entry.entity_id);
  }

  get(id: string): Stored | undefined {
    const row = this.db.getFirstSync<Row>(
      "SELECT id, data FROM structured_assets WHERE id = ?",
      [id],
    );
    return row ? (JSON.parse(row.data) as Stored) : undefined;
  }

  getEntry(entityId: string): WorldBibleEntry | undefined {
    const row = this.db.getFirstSync<Row>(
      "SELECT id, data FROM structured_assets WHERE entity_id_self = ?",
      [entityId],
    );
    return row ? (JSON.parse(row.data) as WorldBibleEntry) : undefined;
  }

  query(filter: StructuredQuery): Stored[] {
    const { sql, params } = buildQuery(filter);
    const rows = this.db.getAllSync<Row>(sql, params);
    return rows.map((r) => JSON.parse(r.data) as Stored);
  }

  delete(id: string): boolean {
    const result = this.db.runSync("DELETE FROM structured_assets WHERE id = ?", [id]);
    this.db.runSync("DELETE FROM structured_asset_entity_refs WHERE asset_id = ?", [id]);
    this.db.runSync("DELETE FROM structured_asset_tags WHERE asset_id = ?", [id]);
    return result.changes > 0;
  }

  size(): number {
    const row = this.db.getFirstSync<{ count: number }>(
      "SELECT COUNT(*) as count FROM structured_assets",
      [],
    );
    return row?.count ?? 0;
  }

  private upsertRow(asset: Stored, entityIdSelf: string | null): void {
    this.db.runSync(
      `INSERT INTO structured_assets (id, network, kind, viewpoint_holder, entity_id_self, data)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         network = excluded.network,
         kind = excluded.kind,
         viewpoint_holder = excluded.viewpoint_holder,
         entity_id_self = excluded.entity_id_self,
         data = excluded.data`,
      [
        asset.id,
        asset.network,
        asset.kind,
        asset.viewpoint_holder ?? null,
        entityIdSelf,
        JSON.stringify(asset),
      ],
    );

    // Simplest-correct approach to keeping junction tables in sync on
    // update: clear this asset's rows, then re-insert from scratch.
    this.db.runSync("DELETE FROM structured_asset_entity_refs WHERE asset_id = ?", [asset.id]);
    this.db.runSync("DELETE FROM structured_asset_tags WHERE asset_id = ?", [asset.id]);

    const entityRefs = new Set<string>(asset.entity_ids);
    if (isWorldBibleEntry(asset)) entityRefs.add(asset.entity_id);
    for (const entityId of entityRefs) {
      this.db.runSync(
        "INSERT INTO structured_asset_entity_refs (asset_id, entity_id) VALUES (?, ?)",
        [asset.id, entityId],
      );
    }
    for (const tag of asset.tags) {
      this.db.runSync(
        "INSERT INTO structured_asset_tags (asset_id, tag) VALUES (?, ?)",
        [asset.id, tag],
      );
    }
  }
}

function buildQuery(filter: StructuredQuery): { sql: string; params: (string | number)[] } {
  const joins: string[] = [];
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filter.entity_id !== undefined) {
    joins.push(
      "JOIN structured_asset_entity_refs er ON er.asset_id = sa.id AND er.entity_id = ?",
    );
    params.push(filter.entity_id);
  }
  if (filter.tag !== undefined) {
    joins.push("JOIN structured_asset_tags at ON at.asset_id = sa.id AND at.tag = ?");
    params.push(filter.tag);
  }

  const networks = asArray(filter.network) as readonly Network[] | undefined;
  if (networks?.length) {
    where.push(`sa.network IN (${networks.map(() => "?").join(", ")})`);
    params.push(...networks);
  }
  const kinds = asArray(filter.kind);
  if (kinds?.length) {
    where.push(`sa.kind IN (${kinds.map(() => "?").join(", ")})`);
    params.push(...kinds);
  }
  if (filter.viewpoint_holder !== undefined) {
    where.push("sa.viewpoint_holder = ?");
    params.push(filter.viewpoint_holder);
  }

  const sql = [
    "SELECT DISTINCT sa.id, sa.data FROM structured_assets sa",
    ...joins,
    where.length ? `WHERE ${where.join(" AND ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { sql, params };
}
