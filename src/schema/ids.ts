/**
 * ID factory for memory assets.
 *
 * Kept behind a function seam so we can swap in a cryptographically-strong
 * generator (e.g. `expo-crypto`'s `randomUUID()`) without touching call
 * sites once Tier 1.2 lands. The current implementation is fine for
 * in-memory work and Jest tests.
 */

const HEX = "0123456789abcdef";

export function newId(): string {
  // 32 hex chars (~UUID-sized) using Math.random — sufficient for the
  // schema layer; storage can override at write time.
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}
