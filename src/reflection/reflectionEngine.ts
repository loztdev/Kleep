/**
 * Tier 4.9 — ReflectionEngine.
 *
 * Periodic "thinker" that runs during low-activity windows. Each tick:
 *
 *   1. Pull every OPINION from the structured store.
 *   2. Pull FACT/OBSERVATION assets and World Bible entries as context.
 *   3. Hand them to the Reflector, get back ReflectionFinding[].
 *   4. For each finding:
 *      - Emit a REFLECTION MemoryAsset (network=OBSERVATION by default)
 *        through the IngestSink so it's deduped, indexed, and surfaced
 *        by the fusion engine like any other asset.
 *      - Apply the optional effect (confidence/relevance delta on the
 *        primary opinion) by re-writing it through the router. The
 *        re-write picks up the new provenance from the engine, with a
 *        DERIVED confidence source.
 *
 * Scheduling is intentionally external — the engine exposes `tick()`
 * and `flush()` only. A higher-level scheduler (Expo TaskManager, a
 * setInterval, or whatever the host wires) decides when to call.
 */

import {
  ConfidenceSource,
  MemoryAssetSchema,
  MemoryKind,
  Network,
  ProvenanceSchema,
  RawQuoteAnchorSchema,
  TemporalRangeSchema,
  newId,
  type MemoryAsset,
  type WorldBibleEntry,
} from "../schema";
import type { MemoryRouter } from "../router";
import type { IngestOutcome, IngestSink } from "../ingest";
import type {
  Reflector,
  ReflectionFinding,
  ReflectionInput,
} from "./types";

export interface ReflectionEngineOptions {
  /** Network for emitted REFLECTION assets. Defaults to OBSERVATION. */
  reflectionNetwork?: Network;
  /** Hard cap on confidence after positive adjustments. */
  maxConfidence?: number;
  /** Floor on confidence after negative adjustments. */
  minConfidence?: number;
}

export interface ReflectionTickResult {
  findings: readonly ReflectionFinding[];
  outcomes: IngestOutcome[];
  adjustedAssets: number;
}

export class ReflectionEngine {
  private readonly reflectionNetwork: Network;
  private readonly maxConfidence: number;
  private readonly minConfidence: number;

  constructor(
    private readonly router: MemoryRouter,
    private readonly reflector: Reflector,
    private readonly sink: IngestSink,
    opts: ReflectionEngineOptions = {},
  ) {
    this.reflectionNetwork = opts.reflectionNetwork ?? Network.OBSERVATION;
    this.maxConfidence = opts.maxConfidence ?? 0.99;
    this.minConfidence = opts.minConfidence ?? 0.05;
  }

  async tick(): Promise<ReflectionTickResult> {
    const input = this.gatherInput();
    if (input.opinions.length === 0) {
      return { findings: [], outcomes: [], adjustedAssets: 0 };
    }
    const findings = await Promise.resolve(this.reflector.reflect(input));

    const outcomes: IngestOutcome[] = [];
    let adjusted = 0;
    for (const f of findings) {
      const primary = this.router.read(f.primary_asset_id);
      if (!primary || isWorldBibleEntry(primary)) continue;

      outcomes.push(this.emitReflection(f, primary));
      if (this.applyEffect(f, primary)) adjusted += 1;
    }
    return { findings, outcomes, adjustedAssets: adjusted };
  }

  // ---- internals -------------------------------------------------------

  private gatherInput(): ReflectionInput {
    const opinions = this.router
      .query({ network: Network.OPINION })
      .filter((a): a is MemoryAsset => !isWorldBibleEntry(a));
    const facts = this.router
      .query({
        network: [Network.WORLD, Network.OBSERVATION, Network.EXPERIENCE],
        kind: MemoryKind.FACT,
      })
      .filter((a): a is MemoryAsset => !isWorldBibleEntry(a));
    const entries = this.router
      .query({ kind: MemoryKind.ENTITY })
      .filter(isWorldBibleEntry);
    return { opinions, facts, entries };
  }

  private emitReflection(
    finding: ReflectionFinding,
    primary: MemoryAsset,
  ): IngestOutcome {
    // The REFLECTION asset anchors back to the primary opinion's source
    // turn, so the Why UI can trace this synthesis all the way down.
    const anchor = RawQuoteAnchorSchema.parse({
      turn_id: primary.provenance.source_turn_id,
      quote: anchorQuoteFor(primary.content),
    });
    const asset = MemoryAssetSchema.parse({
      id: newId(),
      network: this.reflectionNetwork,
      kind: MemoryKind.REFLECTION,
      content: `[${finding.kind}] ${finding.rationale}`,
      entity_ids: [...primary.entity_ids],
      tags: ["cara-reflection", `cara:${finding.kind}`],
      provenance: ProvenanceSchema.parse({
        source_turn_id: primary.provenance.source_turn_id,
        confidence_score: clamp(
          finding.confidence,
          this.minConfidence,
          this.maxConfidence,
        ),
        confidence_source: ConfidenceSource.DERIVED,
        raw_quote_anchors: [anchor],
        temporal_range: TemporalRangeSchema.parse({
          turn_start: primary.provenance.source_turn_id,
        }),
      }),
    });
    return this.sink.ingest(asset);
  }

  private applyEffect(
    finding: ReflectionFinding,
    primary: MemoryAsset,
  ): boolean {
    const eff = finding.effect;
    if (eff.type === "note_only") return false;

    if (eff.type === "adjust_confidence") {
      const adjusted = clamp(
        primary.provenance.confidence_score + eff.delta,
        this.minConfidence,
        this.maxConfidence,
      );
      if (adjusted === primary.provenance.confidence_score) return false;
      const updated: MemoryAsset = {
        ...primary,
        provenance: {
          ...primary.provenance,
          confidence_score: adjusted,
        },
      };
      this.router.write(updated);
      return true;
    }

    if (eff.type === "bump_relevance") {
      const updated: MemoryAsset = {
        ...primary,
        relevance: Math.max(0, primary.relevance + eff.delta),
      };
      this.router.write(updated);
      return true;
    }
    return false;
  }
}

function isWorldBibleEntry(a: unknown): a is WorldBibleEntry {
  const obj = a as { kind?: string; entity_id?: string };
  return obj.kind === MemoryKind.ENTITY && obj.entity_id !== undefined;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function anchorQuoteFor(content: string): string {
  const max = 80;
  if (content.length === 0) return "(empty)";
  return content.length <= max ? content : content.slice(0, max);
}
