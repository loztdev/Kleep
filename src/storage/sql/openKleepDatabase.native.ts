/**
 * Opens (or creates) the on-device SQLite database and runs migrations
 * (iOS/Android only — see `openKleepDatabase.web.ts` for the web stub).
 *
 * `expo-sqlite` wraps a native module that doesn't exist outside an
 * Expo/React Native runtime, so — like `secureKeyStore.ts` — this file is
 * deliberately NOT re-exported from `src/storage/index.ts`; importing it
 * under plain Node (Jest) would throw at module-load time. Import it
 * directly from app code only.
 *
 * This file's `.native.ts` suffix (not just a `Platform.OS` check) matters:
 * Metro resolves imports statically per bundle target, so a plain
 * `openKleepDatabase.ts` that `import`s `expo-sqlite` unconditionally
 * fails the *web* bundle outright (it can't resolve expo-sqlite's web
 * worker's wasm asset) even though the runtime code path returning `null`
 * on web is never reached — the import itself has to resolve first.
 * Splitting into `.native.ts`/`.web.ts` keeps `expo-sqlite` out of the web
 * bundle entirely.
 */

import * as SQLite from "expo-sqlite";
import { runMigrations } from "./schema";
import type { SqlDatabase } from "./types";

const DATABASE_NAME = "kleep.db";

/** Open the shared on-device database, running any pending migrations first. */
export function openKleepDatabase(): SqlDatabase | null {
  const db = SQLite.openDatabaseSync(DATABASE_NAME);
  const asSqlDatabase = db as unknown as SqlDatabase;
  asSqlDatabase.execSync("PRAGMA foreign_keys = ON;");
  runMigrations(asSqlDatabase);
  return asSqlDatabase;
}
