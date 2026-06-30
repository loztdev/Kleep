/**
 * Tier 5.1 — ClaudeExtractor.
 *
 * Replaces `PatternExtractor`'s regex matching with a structured-output
 * Claude call: one forced tool call (`extract_facts`) per turn, validated
 * against a Zod schema that mirrors `ExtractedFact`. Two things are
 * deliberately NOT this class's job, because `AutoRetainEngine` already
 * does them for every `Extractor`:
 *
 * - Anchor verification — Claude returns `quote`; the engine re-checks it's
 *   a verbatim substring of the turn and throws `ExtractionAnchorError` if
 *   not (anti-hallucination guard).
 * - Disposition-aware confidence calibration — the engine's skepticism gate
 *   maps Claude's self-reported `confidence` through `confidenceFloor` /
 *   `mentionsRequired`.
 *
 * What this class does own: prompting, caching identical turn content so a
 * re-extraction doesn't re-pay the API call, and surfacing a per-turn cost
 * cap so a single pathological turn can't blow the extraction budget.
 */

import { z } from "zod";
import type { ClaudeClient } from "../claude";
import { MemoryKind, Network } from "../schema";
import type { Turn } from "../conversation";
import { fnv1aHash } from "../util/hash";
import type { ExtractedFact, Extractor } from "./types";

// These schemas deliberately mirror every constraint `AutoRetainEngine`
// re-validates against downstream (`MemoryAssetSchema`, `WorldBibleEntrySchema`,
// `WorldBibleAttributeSchema` in src/schema/) — a fact that passes here but
// fails there would throw an uncaught ZodError out of `engine.tick()`
// instead of a catchable `StructuredOutputError` here.
const NetworkSchema = z.enum([Network.WORLD, Network.EXPERIENCE, Network.OBSERVATION, Network.OPINION]);
// WorldBibleEntrySchema (src/schema/worldBible.ts) rejects anything but
// WORLD/OBSERVATION for entities — narrower than the atomic-fact NetworkSchema.
const EntityNetworkSchema = z.enum([Network.WORLD, Network.OBSERVATION]);

// ENTITY is excluded here — entity cards go through the "entity" variant below.
const AtomicKindSchema = z.enum([
  MemoryKind.FACT,
  MemoryKind.RULE,
  MemoryKind.LORE,
  MemoryKind.SUMMARY,
  MemoryKind.REFLECTION,
  MemoryKind.OPINION,
]);

const ExtractedAtomicFactSchema = z
  .object({
    type: z.literal("atomic"),
    kind: AtomicKindSchema,
    network: NetworkSchema,
    content: z.string().min(1).describe("Canonicalized statement of the fact, in your own words."),
    quote: z
      .string()
      .min(1)
      .describe("Verbatim, contiguous substring of the turn text that justifies this fact — copied exactly."),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe("Confidence in [0, 1] that the turn text directly and unambiguously supports this fact."),
    entity_ids: z
      .array(z.string().min(1))
      .optional()
      .describe("Canonical ids of entities this fact is about, if any."),
    viewpoint_holder: z
      .string()
      .min(1)
      .optional()
      .describe('Set if and only if network="opinion" — who holds this belief.'),
    tags: z.array(z.string().min(1)).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.network === Network.OPINION && !val.viewpoint_holder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["viewpoint_holder"],
        message: 'viewpoint_holder is required when network is "opinion"',
      });
    }
    if (val.network !== Network.OPINION && val.viewpoint_holder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["viewpoint_holder"],
        message: 'viewpoint_holder is only allowed when network is "opinion"',
      });
    }
  });

const ExtractedAttributeSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  quote: z.string().min(1).describe("Verbatim substring of the turn text that justifies this attribute."),
  confidence: z.number().min(0).max(1),
});

const ExtractedEntitySchema = z.object({
  type: z.literal("entity"),
  entity_id: z.string().min(1).describe('Stable lowercase id, e.g. "char:mojo".'),
  entity_type: z.string().min(1).describe('Free-text entity category, e.g. "character", "location", "item".'),
  canonical_name: z.string().min(1),
  network: EntityNetworkSchema.describe('Entities must use "world" or "observation" — never experience/opinion.'),
  content: z.string().min(1).describe("Canonicalized one-line description of the entity."),
  quote: z.string().min(1).describe("Verbatim, contiguous substring of the turn text that justifies this entity."),
  confidence: z.number().min(0).max(1),
  attributes: z.array(ExtractedAttributeSchema).optional(),
  aliases: z.array(z.string().min(1)).optional(),
  summary: z.string().optional(),
});

const ExtractionResultSchema = z.object({
  facts: z.array(z.union([ExtractedAtomicFactSchema, ExtractedEntitySchema])),
});

const SYSTEM_PROMPT = `You extract structured memory facts from a single conversation turn for Kleep, a narrative memory system.

Rules:
- Only extract facts explicitly supported by the turn text below. Do not infer beyond what's stated.
- "quote" MUST be an exact, verbatim, contiguous substring of the turn text — copy it exactly, including punctuation and capitalization. A fact whose quote can't be found verbatim is discarded.
- "content" must never be empty.
- Use type="atomic" for non-entity claims and type="entity" for entity/character/location/item cards.
- Atomic kind guide: fact=neutral claim, rule=hard/canonical rule, opinion=subjective belief, summary=a recap, reflection=meta commentary, lore=worldbuilding detail meant for semantic recall.
- network guide: world=physics/canon rules, experience=biographical events that happened, observation=neutral currently-true facts, opinion=subjective beliefs.
- Entity cards (type="entity") may ONLY use network="world" or network="observation" — never experience or opinion.
- Set viewpoint_holder if and only if network="opinion" (always set it in that case; never set it otherwise).
- confidence in [0, 1]: how directly and unambiguously the quote supports the fact.
- If the turn contains nothing worth extracting, call the tool with an empty facts array.`;

/** Construction options for `ClaudeExtractor`. */
export interface ClaudeExtractorOptions {
  client: ClaudeClient;
  /** Overrides the client's default model for extraction calls. */
  model?: string;
  /** `max_tokens` for the extraction call. Default 1024. */
  maxTokens?: number;
  /** If a single turn's extraction cost exceeds this, `onCostCapExceeded` fires (the result is still returned). */
  maxCostPerTurnUsd?: number;
  /** Called when a turn's cost exceeds `maxCostPerTurnUsd`. Defaults to a `console.warn`. */
  onCostCapExceeded?: (info: { turnId: string; costUsd: number; capUsd: number }) => void;
  /** Max distinct turn-content hashes kept in the extraction cache. Default 200. */
  cacheSize?: number;
}

/** Claude-backed `Extractor` — structured-output extraction with caching by turn-content hash. */
export class ClaudeExtractor implements Extractor {
  private readonly cache = new Map<string, readonly ExtractedFact[]>();
  private readonly cacheSize: number;

  constructor(private readonly opts: ClaudeExtractorOptions) {
    this.cacheSize = opts.cacheSize ?? 200;
  }

  async extract(turn: Turn): Promise<readonly ExtractedFact[]> {
    const key = hashContent(turn.content);
    const cached = this.cache.get(key);
    if (cached) return cached;

    // totalUsd()-delta assumes no concurrent extract() call shares this
    // client's costTracker mid-flight — true today since AutoRetainEngine
    // processes turns sequentially (for...await), not in parallel.
    const costBefore = this.opts.client.costTracker.totalUsd();
    const result = await this.opts.client.structured({
      ...(this.opts.model !== undefined ? { model: this.opts.model } : {}),
      maxTokens: this.opts.maxTokens ?? 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: turnPrompt(turn) }],
      tool: {
        name: "extract_facts",
        description: "Record every fact and entity card extractable from the turn.",
        schema: ExtractionResultSchema,
      },
    });
    this.checkCostCap(turn, this.opts.client.costTracker.totalUsd() - costBefore);

    const facts = result.data.facts as readonly ExtractedFact[];
    this.cacheSet(key, facts);
    return facts;
  }

  private checkCostCap(turn: Turn, costUsd: number): void {
    const capUsd = this.opts.maxCostPerTurnUsd;
    if (capUsd === undefined || costUsd <= capUsd) return;
    if (this.opts.onCostCapExceeded) {
      this.opts.onCostCapExceeded({ turnId: turn.id, costUsd, capUsd });
    } else {
      console.warn(`ClaudeExtractor: turn ${turn.id} cost $${costUsd.toFixed(4)}, over cap $${capUsd.toFixed(4)}`);
    }
  }

  private cacheSet(key: string, value: readonly ExtractedFact[]): void {
    this.cache.set(key, value);
    // Evict after inserting (not before) so `cacheSize: 0` correctly means
    // "never cache" — evicting first when the map is already at capacity
    // left a single stale entry in place forever for that case.
    while (this.cache.size > this.cacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }
}

function turnPrompt(turn: Turn): string {
  return `Turn (role=${turn.role}, id=${turn.id}):\n"""\n${turn.content}\n"""`;
}

/** Cache key derived from turn content only — by design (see roadmap: "caching by turn-content hash"), so two different turns with byte-identical content intentionally share a cache entry. */
function hashContent(content: string): string {
  return fnv1aHash(content).toString(16);
}
