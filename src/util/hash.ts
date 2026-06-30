/**
 * Shared FNV-1a-style hash core, used wherever Kleep needs a fast,
 * deterministic, dependency-free hash of a string (cache keys, fixture
 * keys, the stub embedder's pseudo-vectors). No Node `crypto` — this has
 * to run under React Native too.
 */

export const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/** One FNV-1a update step: XOR in `code`, multiply by the FNV prime (mod 2^32). */
export function fnv1aStep(hash: number, code: number): number {
  return Math.imul(hash ^ code, FNV_PRIME) >>> 0;
}

/** Full FNV-1a-style hash of `content`, as an unsigned 32-bit integer. */
export function fnv1aHash(content: string): number {
  let hash = FNV_OFFSET_BASIS >>> 0;
  for (let i = 0; i < content.length; i++) {
    hash = fnv1aStep(hash, content.charCodeAt(i));
  }
  return hash;
}
