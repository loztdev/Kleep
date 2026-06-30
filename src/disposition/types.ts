/**
 * Tier 4.10 — Tunable Disposition Matrix.
 *
 * Two sliders the operator (or user-facing UI) can dial:
 *
 *   - `skepticism` (0..1) — how guarded the AutoRetainEngine is about
 *     accepting new facts into the World Bible. Higher values raise
 *     the per-fact confidence floor AND/OR require multiple
 *     corroborating mentions before a sub-threshold fact persists.
 *
 *   - `literalism` (0..1) — how strongly the FusionRecallEngine
 *     prioritizes hard WORLD-network facts over softer LORE / OPINION
 *     content during retrieval. Higher values boost WORLD scores in
 *     the RRF combination.
 *
 * Both default to 0, which means "engines behave exactly as if no
 * matrix were configured" — existing tests stay green and callers can
 * opt in by passing a matrix to engine constructors.
 */

export interface DispositionMatrix {
  /** 0 = trust everything, 1 = require strong evidence. */
  skepticism: number;
  /** 0 = lore freely outranks rules, 1 = WORLD facts dominate. */
  literalism: number;
}

/** No-op matrix — engines behave as if no disposition were configured. */
export const NEUTRAL_DISPOSITION: DispositionMatrix = Object.freeze({
  skepticism: 0,
  literalism: 0,
});

/** Merge a partial matrix onto `NEUTRAL_DISPOSITION` and clamp each slider into [0, 1]. */
export function withDefaults(
  partial?: Partial<DispositionMatrix>,
): DispositionMatrix {
  return {
    skepticism: clamp01(partial?.skepticism ?? NEUTRAL_DISPOSITION.skepticism),
    literalism: clamp01(partial?.literalism ?? NEUTRAL_DISPOSITION.literalism),
  };
}

/**
 * Computes the confidence floor for a disposition matrix.
 *
 * @param d - The disposition matrix to evaluate
 * @returns The confidence floor derived from `d.skepticism`
 */
export function confidenceFloor(d: DispositionMatrix): number {
  return d.skepticism * 0.6;
}

/**
 * Computes the corroboration count required for a fact to persist.
 *
 * @param d - The disposition matrix used to derive the threshold
 * @returns The minimum number of mentions required, with a floor of 1
 */
export function mentionsRequired(d: DispositionMatrix): number {
  return Math.max(1, Math.ceil(d.skepticism * 4));
}

/**
 * Computes the WORLD-network score multiplier from literalism.
 *
 * @param d - The disposition matrix.
 * @returns The multiplier applied to WORLD-network assets.
 */
export function worldBoostMultiplier(d: DispositionMatrix): number {
  return 1 + d.literalism * 2;
}

/**
 * Clamps a numeric value to the range from 0 to 1.
 *
 * @returns `0` for non-finite values; otherwise the value constrained to the range from 0 to 1.
 */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
