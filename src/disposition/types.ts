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

export const NEUTRAL_DISPOSITION: DispositionMatrix = {
  skepticism: 0,
  literalism: 0,
};

export function withDefaults(
  partial?: Partial<DispositionMatrix>,
): DispositionMatrix {
  return {
    skepticism: clamp01(partial?.skepticism ?? NEUTRAL_DISPOSITION.skepticism),
    literalism: clamp01(partial?.literalism ?? NEUTRAL_DISPOSITION.literalism),
  };
}

/**
 * Per-skepticism confidence floor — a fact whose confidence is below
 * this can still persist, but only after multiple corroborations.
 * Above the floor, single-mention acceptance is fine.
 *
 * Floor maxes at 0.6 so at full skepticism, ~user-asserted facts
 * (typically scored 0.7+) still flow through on a single mention.
 */
export function confidenceFloor(d: DispositionMatrix): number {
  return d.skepticism * 0.6;
}

/**
 * Per-skepticism corroboration count — how many times a sub-floor
 * fact must show up before the engine persists it. At skepticism=0,
 * a single mention is enough (no skepticism); at 1, four mentions.
 */
export function mentionsRequired(d: DispositionMatrix): number {
  return Math.max(1, Math.ceil(d.skepticism * 4));
}

/**
 * Per-literalism score multiplier for WORLD-network assets in fusion.
 * literalism=0 → 1× (no boost). literalism=1 → 3× boost.
 */
export function worldBoostMultiplier(d: DispositionMatrix): number {
  return 1 + d.literalism * 2;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
