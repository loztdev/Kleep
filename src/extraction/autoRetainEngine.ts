/**
 * Tier 2.4: AutoRetainEngine.
 *
 * Pulls unprocessed turns from the ConversationBuffer, runs them
 * through the Extractor, and ingests the results. The engine is the
 * trust boundary: it re-verifies that every extracted quote actually
 * appears verbatim in the source turn (anti-hallucination guard),
 * computes the character span, and packages a complete Provenance
 * bundle so the schema can never see a half-anchored asset.
 *
 * The engine writes through an `IngestSink`, not directly to the
 * router — that's what lets the Tier 2.5 DedupReconciler plug in
 * without the engine knowing it exists.
 */

import {
  ConfidenceSource,
  LoreSnippetSchema,
  MemoryAssetSchema,
  ProvenanceSchema,
  RawQuoteAnchorSchema,
  TemporalRangeSchema,
  WorldBibleAttributeSchema,
  WorldBibleEntrySchema,
  newId,
  type LoreSnippet,
  type MemoryAsset,
  type WorldBibleEntry,
} from "../schema";
import type { ConversationBuffer, Turn } from "../conversation";
import type { Embedder } from "../embedding";
import type {
  AnyAsset,
  IngestOutcome,
  IngestSink,
} from "../ingest/types";
import type {
  ExtractedAtomicFact,
  ExtractedAttribute,
  ExtractedEntity,
  ExtractedFact,
  Extractor,
} from "./types";

export class ExtractionAnchorError extends Error {
  constructor(public readonly turnId: string, public readonly quote: string) {
    super(
      `extractor returned a quote not found in turn ${turnId}: ${JSON.stringify(
        quote,
      )}`,
    );
    this.name = "ExtractionAnchorError";
  }
}

export class MissingEmbedderError extends Error {
  constructor() {
    super(
      "AutoRetainEngine received a LORE fact but no embedder is configured",
    );
    this.name = "MissingEmbedderError";
  }
}

export interface ExtractionTickResult {
  turnsProcessed: number;
  outcomes: IngestOutcome[];
}

export interface AutoRetainEngineOptions {
  /**
   * How the engine reacts when the extractor returns a quote that
   * isn't a verbatim substring of the turn:
   * - "throw"  (default) — bail and don't ingest anything from the turn
   * - "skip"   — drop just the bad fact, keep the rest
   */
  onAnchorMiss?: "throw" | "skip";
  /**
   * Default confidence source applied to ingested assets. Tier 4.10's
   * disposition matrix can override this per-engine.
   */
  defaultConfidenceSource?: ConfidenceSource;
  /**
   * Required if extracted facts may be of kind LORE — the engine
   * computes the embedding before handing the snippet to the sink so
   * the vector store can accept it.
   */
  embedder?: Embedder;
}

export class AutoRetainEngine {
  private readonly onAnchorMiss: "throw" | "skip";
  private readonly defaultConfidenceSource: ConfidenceSource;
  private readonly embedder?: Embedder;

  constructor(
    private readonly buffer: ConversationBuffer,
    private readonly extractor: Extractor,
    private readonly sink: IngestSink,
    opts: AutoRetainEngineOptions = {},
  ) {
    this.onAnchorMiss = opts.onAnchorMiss ?? "throw";
    this.defaultConfidenceSource =
      opts.defaultConfidenceSource ?? ConfidenceSource.INFERRED;
    this.embedder = opts.embedder;
  }

  /**
   * Process every pending turn. Returns a summary of what landed.
   * After a successful tick the buffer's high-water mark advances
   * past the last processed turn.
   */
  async tick(): Promise<ExtractionTickResult> {
    const pending = this.buffer.pendingTurns();
    let lastId: string | undefined;
    const outcomes: IngestOutcome[] = [];

    for (const turn of pending) {
      const facts = await Promise.resolve(this.extractor.extract(turn));
      for (const fact of facts) {
        const built = this.materialize(turn, fact);
        if (!built) continue;
        const ready = await this.embedIfLore(built);
        outcomes.push(this.sink.ingest(ready));
      }
      lastId = turn.id;
    }

    if (lastId) this.buffer.markProcessed(lastId);
    return { turnsProcessed: pending.length, outcomes };
  }

  // ---- internals -------------------------------------------------------

  private async embedIfLore(asset: AnyAsset): Promise<AnyAsset> {
    if (asset.kind !== "lore") return asset;
    const lore = asset as LoreSnippet;
    if (lore.embedding && lore.embedding.length > 0) return lore;
    if (!this.embedder) throw new MissingEmbedderError();
    const vec = await Promise.resolve(this.embedder.embed(lore.content));
    return {
      ...lore,
      embedding: [...vec],
      embedding_model: this.embedder.model,
    };
  }

  private materialize(turn: Turn, fact: ExtractedFact): AnyAsset | null {
    try {
      return fact.type === "entity"
        ? this.buildEntity(turn, fact)
        : this.buildAtomic(turn, fact);
    } catch (err) {
      if (err instanceof ExtractionAnchorError && this.onAnchorMiss === "skip") {
        return null;
      }
      throw err;
    }
  }

  private buildAtomic(
    turn: Turn,
    fact: ExtractedAtomicFact,
  ): MemoryAsset | LoreSnippet {
    const anchor = this.anchor(turn, fact.quote);
    const provenance = this.provenance(turn, fact.confidence, anchor);

    const base = {
      id: newId(),
      network: fact.network,
      kind: fact.kind,
      content: fact.content,
      provenance,
      entity_ids: [...(fact.entity_ids ?? [])],
      tags: [...(fact.tags ?? [])],
      ...(fact.viewpoint_holder
        ? { viewpoint_holder: fact.viewpoint_holder }
        : {}),
    };

    // LORE rides the vector store; everything else is structured.
    return fact.kind === "lore"
      ? LoreSnippetSchema.parse(base)
      : MemoryAssetSchema.parse(base);
  }

  private buildEntity(turn: Turn, fact: ExtractedEntity): WorldBibleEntry {
    const anchor = this.anchor(turn, fact.quote);
    const provenance = this.provenance(turn, fact.confidence, anchor);
    const attributes = (fact.attributes ?? []).map((a) =>
      this.buildAttribute(turn, a),
    );

    return WorldBibleEntrySchema.parse({
      id: newId(),
      network: fact.network,
      content: fact.content,
      provenance,
      entity_id: fact.entity_id,
      entity_type: fact.entity_type,
      canonical_name: fact.canonical_name,
      aliases: [...(fact.aliases ?? [])],
      attributes,
      ...(fact.summary !== undefined ? { summary: fact.summary } : {}),
    });
  }

  private buildAttribute(turn: Turn, attr: ExtractedAttribute) {
    const anchor = this.anchor(turn, attr.quote);
    return WorldBibleAttributeSchema.parse({
      key: attr.key,
      value: attr.value,
      provenance: this.provenance(turn, attr.confidence, anchor),
    });
  }

  private anchor(turn: Turn, quote: string) {
    const idx = turn.content.indexOf(quote);
    if (idx < 0 || quote.length === 0) {
      throw new ExtractionAnchorError(turn.id, quote);
    }
    return RawQuoteAnchorSchema.parse({
      turn_id: turn.id,
      quote,
      char_start: idx,
      char_end: idx + quote.length,
    });
  }

  private provenance(
    turn: Turn,
    confidence: number,
    anchor: ReturnType<typeof RawQuoteAnchorSchema.parse>,
  ) {
    return ProvenanceSchema.parse({
      source_turn_id: turn.id,
      confidence_score: confidence,
      confidence_source: this.defaultConfidenceSource,
      raw_quote_anchors: [anchor],
      temporal_range: TemporalRangeSchema.parse({ turn_start: turn.id }),
    });
  }
}
