/**
 * Test-only `SqlDatabase` adapter over `better-sqlite3` — a real SQLite
 * engine runnable under plain Jest/Node, standing in for `expo-sqlite`
 * (a native module that can't load outside an Expo/RN runtime). Mirrors
 * `FixtureTransport`'s role for the Claude/OpenRouter clients: exercise
 * the real query logic against a real database, not a mock.
 */

import Database from "better-sqlite3";
import { runMigrations } from "../sql/schema";
import type { SqlDatabase, SqlParam } from "../sql/types";

/** A fresh, isolated in-memory SQLite database with migrations applied. */
export function openTestDatabase(): SqlDatabase {
  const db = new Database(":memory:");
  const adapter: SqlDatabase = {
    execSync(source) {
      db.exec(source);
    },
    runSync(source, params) {
      const info = db.prepare(source).run(...(params as SqlParam[]));
      return { changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) };
    },
    getAllSync<T>(source: string, params: readonly SqlParam[]) {
      return db.prepare(source).all(...params) as T[];
    },
    getFirstSync<T>(source: string, params: readonly SqlParam[]) {
      return (db.prepare(source).get(...params) ?? null) as T | null;
    },
  };
  runMigrations(adapter);
  return adapter;
}
