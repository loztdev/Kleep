/**
 * Provenance primitives — required metadata for every memory asset.
 *
 * These four fields together let later tiers answer "why does the system
 * believe this?": which turn produced it, how confident we are, the exact
 * quotes that pin it to source material, and the window of time it's
 * valid for. They are non-negotiable per the Tier 1 spec — they cannot
 * be added retroactively once databases start filling up, so the schema
 * enforces them at construction time.
 */

import { z } from "zod";

/**
 * Opaque identifier for a single conversational turn. We keep it as a
 * string so backends (UUIDs, monotonic counters, hashes) can choose
 * their own scheme without churning the schema.
 */
/** Zod validator for a non-empty TurnId string. */
export const TurnIdSchema = z.string().min(1);
/** Inferred TS type — alias for non-empty string. */
export type TurnId = z.infer<typeof TurnIdSchema>;

/**
 * Where a confidence_score came from. Tier 1 just records the source;
 * tuning (Tier 4.10) consumes it.
 */
export const ConfidenceSource = {
  USER_ASSERTED: "user_asserted",
  NARRATOR_ASSERTED: "narrator_asserted",
  INFERRED: "inferred",
  DERIVED: "derived",
  EXTERNAL: "external",
} as const;

/** String-literal union for the `ConfidenceSource` enum. */
export type ConfidenceSource =
  (typeof ConfidenceSource)[keyof typeof ConfidenceSource];

/** Zod validator for the `ConfidenceSource` enum. */
export const ConfidenceSourceSchema = z.enum([
  ConfidenceSource.USER_ASSERTED,
  ConfidenceSource.NARRATOR_ASSERTED,
  ConfidenceSource.INFERRED,
  ConfidenceSource.DERIVED,
  ConfidenceSource.EXTERNAL,
]);

/**
 * An exact-text pointer back to the source material. Tier 4.8 ("The Why
 * UI") renders these so users can see the literal turn text that
 * justified a stored fact.
 */
export const RawQuoteAnchorSchema = z
  .object({
    turn_id: TurnIdSchema,
    quote: z.string().min(1),
    char_start: z.number().int().nonnegative().optional(),
    char_end: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasStart = val.char_start !== undefined;
    const hasEnd = val.char_end !== undefined;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "char_start and char_end must be provided together",
      });
      return;
    }
    if (hasStart && hasEnd && val.char_end! <= val.char_start!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "char_end must be greater than char_start",
      });
    }
  });

/** Inferred TS type for a validated `RawQuoteAnchor`. */
export type RawQuoteAnchor = z.infer<typeof RawQuoteAnchorSchema>;

/**
 * When a fact is valid.
 *
 * We track two clocks:
 *
 * - `turn_start` / `turn_end` — real-world *conversation* time. A fact
 *   becomes known at turn_start and (optionally) is retired at turn_end.
 * - `narrative_start` / `narrative_end` — *in-fiction* time. Free-form
 *   strings (e.g. "Year 921 of the Third Age", "before the war") because
 *   narrative time has no universal calendar.
 *
 * `narrative_always` short-circuits both narrative bounds — used for
 * timeless WORLD facts like physical laws.
 */
export const TemporalRangeSchema = z
  .object({
    turn_start: TurnIdSchema,
    turn_end: TurnIdSchema.optional(),
    narrative_start: z.string().optional(),
    narrative_end: z.string().optional(),
    narrative_always: z.boolean().default(false),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.narrative_always && (val.narrative_start || val.narrative_end)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "narrative_always is incompatible with narrative_start/narrative_end",
      });
    }
  });

/** Inferred TS type for a validated `TemporalRange`. */
export type TemporalRange = z.infer<typeof TemporalRangeSchema>;

/**
 * The required tracking bundle every memory asset carries.
 *
 * Validator enforces that at least one raw quote anchor references the
 * declared source turn — otherwise the source_turn_id is unmoored from
 * any actual quote.
 */
export const ProvenanceSchema = z
  .object({
    source_turn_id: TurnIdSchema,
    confidence_score: z.number().min(0).max(1),
    confidence_source: ConfidenceSourceSchema.default(
      ConfidenceSource.INFERRED,
    ),
    raw_quote_anchors: z.array(RawQuoteAnchorSchema).min(1),
    temporal_range: TemporalRangeSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    const anchored = val.raw_quote_anchors.some(
      (a) => a.turn_id === val.source_turn_id,
    );
    if (!anchored) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "At least one raw_quote_anchor must reference source_turn_id",
      });
    }
  });

/** Inferred TS type for a validated `Provenance` bundle. */
export type Provenance = z.infer<typeof ProvenanceSchema>;
