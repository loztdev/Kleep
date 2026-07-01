/**
 * Opens (or creates) the on-device SQLite database and runs migrations.
 *
 * `expo-sqlite` wraps a native module that doesn't exist outside an
 * Expo/React Native runtime, so — like `secureKeyStore.ts` — this file is
 * deliberately NOT re-exported from `src/storage/index.ts`; importing it
 * under plain Node (Jest) would throw at module-load time. Import it
 * directly from app code only.
 *
 * Returns `null` on web: `expo-sqlite`'s web backend exists but its sync
 * API (what every store here is written against, to avoid an async
 * rewrite of the whole memory pipeline) isn't a good fit for a
 * WASM/OPFS-backed browser database. Same policy as `secureKeyStore.ts` —
 * web is the debug/testing target, not the real distribution target, so
 * it falls back to a fresh in-memory pipeline instead (see `App.tsx`).
 */

import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";
import { runMigrations } from "./schema";
import type { SqlDatabase } from "./types";

const DATABASE_NAME = "kleep.db";

/** Open the shared on-device database, running any pending migrations first. `null` on web. */
export function openKleepDatabase(): SqlDatabase | null {
  if (Platform.OS === "web") return null;
  const db = SQLite.openDatabaseSync(DATABASE_NAME);
  const asSqlDatabase = db as unknown as SqlDatabase;
  asSqlDatabase.execSync("PRAGMA foreign_keys = ON;");
  runMigrations(asSqlDatabase);
  return asSqlDatabase;
}
