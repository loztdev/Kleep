/**
 * The seam between our SQLite-backed stores and the actual driver — real
 * `expo-sqlite` (`openDatabaseSync()` already satisfies this shape
 * structurally, no adapter needed) in the app, `better-sqlite3` behind a
 * thin wrapper in tests. Mirrors the existing `ClaudeTransport`/
 * `OpenRouterTransport` pattern: write the real logic against an
 * interface, swap the driver underneath for tests.
 *
 * Deliberately synchronous, not `*Async` — `StructuredStore`/`VectorStore`
 * (src/storage/types.ts) are synchronous interfaces already relied on
 * throughout the memory pipeline (MemoryRouter, DedupReconciler,
 * AutoRetainEngine); `expo-sqlite` exposes a full sync API
 * (`execSync`/`runSync`/`getAllSync`/`getFirstSync`) specifically so
 * callers can avoid a page-wide async refactor for local, on-device data
 * of this size. Revisit if write volume ever makes this jank the JS
 * thread — nothing here precludes an async rewrite later.
 */

/** A single bound parameter value accepted by SQLite. */
export type SqlParam = string | number | null;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

/** Minimal synchronous SQL surface our stores are written against. */
export interface SqlDatabase {
  execSync(source: string): void;
  runSync(source: string, params: readonly SqlParam[]): SqlRunResult;
  getAllSync<T>(source: string, params: readonly SqlParam[]): T[];
  getFirstSync<T>(source: string, params: readonly SqlParam[]): T | null;
}
