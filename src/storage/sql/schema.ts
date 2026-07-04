/**
 * Schema + migration runner shared by every SQLite-backed store
 * (`SqliteStructuredStore`, `SqliteVectorStore`, `ChatSessionStore`) and
 * the chat-history tables. One `migrations` table tracks which numbered
 * migrations have run; each migration is idempotent SQL (`IF NOT EXISTS`
 * everywhere) so re-running a partially-applied migration is safe.
 */

import { withTransaction } from "./transaction";
import type { SqlDatabase } from "./types";

interface Migration {
  id: string;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS structured_assets (
        id TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        kind TEXT NOT NULL,
        viewpoint_holder TEXT,
        entity_id_self TEXT,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_structured_assets_network ON structured_assets(network);
      CREATE INDEX IF NOT EXISTS idx_structured_assets_kind ON structured_assets(kind);
      CREATE INDEX IF NOT EXISTS idx_structured_assets_viewpoint ON structured_assets(viewpoint_holder);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_structured_assets_entity_id_self ON structured_assets(entity_id_self) WHERE entity_id_self IS NOT NULL;

      CREATE TABLE IF NOT EXISTS structured_asset_entity_refs (
        asset_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        PRIMARY KEY (asset_id, entity_id),
        FOREIGN KEY (asset_id) REFERENCES structured_assets(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_asset_entity_refs_entity ON structured_asset_entity_refs(entity_id);

      CREATE TABLE IF NOT EXISTS structured_asset_tags (
        asset_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (asset_id, tag),
        FOREIGN KEY (asset_id) REFERENCES structured_assets(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON structured_asset_tags(tag);

      CREATE TABLE IF NOT EXISTS lore_snippets (
        id TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        viewpoint_holder TEXT,
        embedding TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lore_snippets_network ON lore_snippets(network);
      CREATE INDEX IF NOT EXISTS idx_lore_snippets_viewpoint ON lore_snippets(viewpoint_holder);

      CREATE TABLE IF NOT EXISTS lore_snippet_tags (
        snippet_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (snippet_id, tag),
        FOREIGN KEY (snippet_id) REFERENCES lore_snippets(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_lore_snippet_tags_tag ON lore_snippet_tags(tag);

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider_kind TEXT NOT NULL,
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        processed_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS chat_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        summarized INTEGER NOT NULL DEFAULT 0,
        UNIQUE (session_id, turn_index),
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_chat_turns_session ON chat_turns(session_id, turn_index);
    `,
  },
  {
    id: "0002_prompts",
    sql: `
      CREATE TABLE IF NOT EXISTS saved_prompts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      ALTER TABLE chat_sessions ADD COLUMN system_prompt TEXT;
    `,
  },
  {
    id: "0003_jailbreaks",
    sql: `
      ALTER TABLE saved_prompts ADD COLUMN kind TEXT NOT NULL DEFAULT 'persona';
      CREATE INDEX IF NOT EXISTS idx_saved_prompts_kind ON saved_prompts(kind);

      ALTER TABLE chat_sessions ADD COLUMN jailbreak_prompt TEXT;
    `,
  },
];

/** Create the migrations table and apply any migration not yet recorded, in order. */
export function runMigrations(db: SqlDatabase): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    db.getAllSync<{ id: string }>("SELECT id FROM migrations", []).map((r) => r.id),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    // Apply + record as one transaction: a crash between the two (e.g. after
    // `ALTER TABLE ... ADD COLUMN`, before the migrations-table insert) would
    // otherwise replay a non-idempotent statement on next boot and crash
    // again with "duplicate column name" — not every statement in a
    // migration can use `IF NOT EXISTS`.
    withTransaction(db, () => {
      db.execSync(migration.sql);
      db.runSync("INSERT INTO migrations (id, applied_at) VALUES (?, ?)", [
        migration.id,
        Date.now(),
      ]);
    });
  }
}
