/**
 * Wraps a multi-statement write in BEGIN/COMMIT/ROLLBACK so a mid-write
 * failure (e.g. one of several linked INSERTs) can't leave a row and its
 * junction-table entries out of sync with each other.
 */

import type { SqlDatabase } from "./types";

export function withTransaction<T>(db: SqlDatabase, fn: () => T): T {
  db.execSync("BEGIN");
  try {
    const result = fn();
    db.execSync("COMMIT");
    return result;
  } catch (err) {
    db.execSync("ROLLBACK");
    throw err;
  }
}
