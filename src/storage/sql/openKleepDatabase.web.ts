/**
 * Web stub — deliberately does not import `expo-sqlite` at all (see
 * `openKleepDatabase.native.ts`'s doc comment for why: Metro resolves
 * imports per bundle target, so even an unreached `expo-sqlite` import
 * breaks the web bundle). `expo-sqlite`'s web backend exists but its
 * sync API (what every store here is written against, to avoid an async
 * rewrite of the whole memory pipeline) isn't a good fit for a
 * WASM/OPFS-backed browser database anyway. Same policy as
 * `secureKeyStore.ts` — web is the debug/testing target, not the real
 * distribution target, so it falls back to a fresh in-memory pipeline
 * instead (see `App.tsx`).
 */

import type { SqlDatabase } from "./types";

/** Always `null` on web. */
export function openKleepDatabase(): SqlDatabase | null {
  return null;
}
