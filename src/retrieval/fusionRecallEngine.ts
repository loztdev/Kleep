/**
 * Tier 3.6 — 4-Way Fusion Recall Engine.
 *
 * Combines four retrieval channels via Reciprocal Rank Fusion (RRF):
 *
 *   1. VECTOR        — semantic similarity over LoreSnippet embeddings
 *                      (via MemoryRouter.semanticQuery)
 *   2. BM25          — exact-keyword scoring over indexed content
 *   3. ENTITY GRAPH  — mentions in the query → assets that reference
 *                      those entities (via byEntityRef in storage)
 *   4. CHRONOLOGICAL — most-recently-updated assets (recency boost)
 *
 * Each channel produces a ranked candidate list; RRF folds them into a
 * single ranking. The engine then drops anything that fails network /
 * viewpoint scope, fetches the actual assets, and (optionally) trims
 * the tail to fit a token budget — the spec's "50k → 1k" promise.
 *
 * The engine maintains its own BM25 + entity + chronological indexes.
 * Callers wire it in via `IndexingSink` so every successful write
 * (post-dedup) is mirrored into these indexes. The vector channel
 * doesn't need a mirror — it queries the actual vector store.
 */

import type { Embedder } from "../embedding";
import type { AnyAsset } from "../ingest";
import { MemoryKind, type WorldBibleEntry } from "../schema";
import type { MemoryRouter } from "../router";
import { Network } from "../schema";
import {
  withDefaults,
  worldBoostMultiplier,
  type DispositionMatrix,
} from "../disposition";
import { Bm25Index } from "./bm25";
import { EntityIndex } from "./entityIndex";
import { estimateTokensByChars, type TokenEstimator } from "./tokenBudget";

/** Construction options for `FusionRecallEngine`. */
export interface FusionRecallEngineOptions {
  router: MemoryRouter;
  embedder?: Embedder;
  /** RRF damping constant. 60 is the standard literature value. */
  rrfK?: number;
  /** Per-channel candidate count before fusion. */
  channelTopK?: number;
  /** Token estimator for budgeted recall (defaults to chars/4). */
  estimateTokens?: TokenEstimator;
  /**
   * Tier 4.10 — literalism slider. Boosts the fused score of WORLD-
   * network assets so hard rules outrank softer LORE/OPINION at
   * retrieval time. Default is neutral (literalism=0 → no boost).
   */
  disposition?: Partial<DispositionMatrix>;
}

/** Per-call recall tuning: scope filters, channel toggles, budget. */
export interface RecallOptions {
  topK?: number;
  /** Hard cap on the sum of estimated tokens across returned assets. */
  tokenBudget?: number;
  network?: Network | readonly Network[];
  viewpoint_holder?: string;
  /** Disable individual channels — useful for tests / ablation. */
  channels?: {
    vector?: boolean;
    bm25?: boolean;
    entity?: boolean;
    chronological?: boolean;
  };
  /** Per-call disposition override (otherwise the engine's default). */
  disposition?: Partial<DispositionMatrix>;
}

/** One hit returned from `FusionRecallEngine.recall`. */
export interface RecallResult {
  asset: AnyAsset;
  /** Fused RRF score (higher == more relevant). */
  score: number;
  /** Estimated tokens this asset contributes to the prompt budget. */
  tokens: number;
  /** Which channels surfaced this asset. */
  channels: ReadonlyArray<"vector" | "bm25" | "entity" | "chronological">;
}

type Channel = "vector" | "bm25" | "entity" | "chronological";

interface RankedHit {
  id: string;
  rank: number; // 0-indexed
}

/** Tier 3.6 4-channel recall engine combining vector + BM25 + entity + recency via RRF. */
export class FusionRecallEngine {
  private readonly router: MemoryRouter;
  private readonly embedder?: Embedder;
  private readonly rrfK: number;
  private readonly channelTopK: number;
  private readonly estimateTokens: TokenEstimator;
  private readonly disposition: DispositionMatrix;

  private readonly bm25 = new Bm25Index();
  private readonly entities = new EntityIndex();
  /** Recency table: id → opaque "turn key" (we sort lexicographically). */
  private readonly recency = new Map<string, string>();

  constructor(opts: FusionRecallEngineOptions) {
    this.router = opts.router;
    this.embedder = opts.embedder;
    this.rrfK = opts.rrfK ?? 60;
    this.channelTopK = opts.channelTopK ?? 50;
    this.estimateTokens = opts.estimateTokens ?? estimateTokensByChars;
    this.disposition = withDefaults(opts.disposition);
  }

  /**
   * Mirror a freshly-stored asset into the retrieval indexes. Safe to
   * call multiple times for the same id — re-index is a replace.
   */
  index(asset: AnyAsset): void {
    this.bm25.add(asset.id, indexableText(asset));
    if (isWorldBibleEntry(asset)) this.entities.add(asset);
    this.recency.set(asset.id, recencyKey(asset));
  }

  /** Drop an id from every index. */
  remove(id: string): void {
    this.bm25.remove(id);
    this.entities.remove(id);
    this.recency.delete(id);
  }

  /**
   * Run the four-channel recall pipeline against `query`. Returns
   * scoped, fused, and (if `tokenBudget` is set) trimmed results.
   */
  async recall(
    query: string,
    opts: RecallOptions = {},
  ): Promise<RecallResult[]> {
    const channels = {
      vector: opts.channels?.vector ?? true,
      bm25: opts.channels?.bm25 ?? true,
      entity: opts.channels?.entity ?? true,
      chronological: opts.channels?.chronological ?? true,
    };

    const ranked: Partial<Record<Channel, RankedHit[]>> = {};

    if (channels.vector) ranked.vector = await this.vectorChannel(query, opts);
    if (channels.bm25) ranked.bm25 = this.bm25Channel(query);
    if (channels.entity) ranked.entity = this.entityChannel(query);
    if (channels.chronological) ranked.chronological = this.chronologicalChannel();

    const fused = this.fuse(ranked);
    const hydrated = this.hydrateAndFilter(fused, opts);
    const boosted = this.applyLiteralism(hydrated, opts);
    return this.applyBudget(boosted, opts);
  }

  // ---- channels --------------------------------------------------------

  /** Vector channel — semantic similarity via the configured embedder. */
  private async vectorChannel(
    query: string,
    opts: RecallOptions,
  ): Promise<RankedHit[]> {
    if (!this.embedder) return [];
    const vec = await Promise.resolve(this.embedder.embed(query));
    const hits = this.router.semanticQuery(vec, this.channelTopK, {
      network: opts.network,
      viewpoint_holder: opts.viewpoint_holder,
    });
    return hits.map((h, rank) => ({ id: h.snippet.id, rank }));
  }

  /** BM25 channel — exact-keyword ranking. */
  private bm25Channel(query: string): RankedHit[] {
    return this.bm25
      .search(query, this.channelTopK)
      .map((h, rank) => ({ id: h.id, rank }));
  }

  /** Entity-graph channel — assets referencing entities mentioned in the query. */
  private entityChannel(query: string): RankedHit[] {
    const mentioned = this.entities.mentionsIn(query);
    if (mentioned.length === 0) return [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const entityId of mentioned) {
      for (const a of this.router.query({ entity_id: entityId })) {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          ids.push(a.id);
        }
      }
    }
    return ids.slice(0, this.channelTopK).map((id, rank) => ({ id, rank }));
  }

  /** Recency channel — assets sorted by their latest turn key. */
  private chronologicalChannel(): RankedHit[] {
    return [...this.recency.entries()]
      .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
      .slice(0, this.channelTopK)
      .map(([id], rank) => ({ id, rank }));
  }

  // ---- fusion ----------------------------------------------------------

  /** Combine per-channel ranks via Reciprocal Rank Fusion. */
  private fuse(
    ranked: Partial<Record<Channel, RankedHit[]>>,
  ): Array<{ id: string; score: number; channels: Channel[] }> {
    const scores = new Map<
      string,
      { score: number; channels: Set<Channel> }
    >();

    for (const ch of Object.keys(ranked) as Channel[]) {
      for (const hit of ranked[ch]!) {
        const entry = scores.get(hit.id) ?? {
          score: 0,
          channels: new Set<Channel>(),
        };
        entry.score += 1 / (this.rrfK + hit.rank + 1);
        entry.channels.add(ch);
        scores.set(hit.id, entry);
      }
    }

    return [...scores.entries()]
      .map(([id, v]) => ({ id, score: v.score, channels: [...v.channels] }))
      .sort((a, b) => b.score - a.score);
  }

  /** Materialize fused ids into RecallResults and drop off-scope assets. */
  private hydrateAndFilter(
    fused: Array<{ id: string; score: number; channels: Channel[] }>,
    opts: RecallOptions,
  ): RecallResult[] {
    const networks = asArray(opts.network);
    const out: RecallResult[] = [];
    for (const f of fused) {
      const asset = this.router.read(f.id);
      if (!asset) continue;
      if (networks && !networks.includes(asset.network as Network)) continue;
      if (
        opts.viewpoint_holder !== undefined &&
        asset.viewpoint_holder !== opts.viewpoint_holder
      ) {
        continue;
      }
      out.push({
        asset,
        score: f.score,
        tokens: this.estimateTokens(asset.content),
        channels: f.channels,
      });
    }
    return out;
  }

  /**
   * Tier 4.10 — literalism boost.
   *
   * Multiplies WORLD-network scores by `worldBoostMultiplier`. Per-call
   * disposition (if supplied) wins over the engine's default so the
   * UI's slider can dial it live without rebuilding the engine.
   */
  private applyLiteralism(
    hits: RecallResult[],
    opts: RecallOptions,
  ): RecallResult[] {
    const d = opts.disposition
      ? withDefaults({ ...this.disposition, ...opts.disposition })
      : this.disposition;
    const boost = worldBoostMultiplier(d);
    if (boost === 1) return hits;
    const reweighted = hits.map((h) =>
      h.asset.network === Network.WORLD
        ? { ...h, score: h.score * boost }
        : h,
    );
    reweighted.sort((a, b) => b.score - a.score);
    return reweighted;
  }

  /**
   * Greedy token-budget trim. Drops hits whose tokens would push the
   * running total past `tokenBudget`; respects `topK` as a hard ceiling.
   */
  private applyBudget(
    hits: RecallResult[],
    opts: RecallOptions,
  ): RecallResult[] {
    const topK = opts.topK ?? hits.length;
    const budget = opts.tokenBudget;
    if (budget === undefined) return hits.slice(0, topK);

    const out: RecallResult[] = [];
    let spent = 0;
    for (const h of hits) {
      if (out.length >= topK) break;
      if (spent + h.tokens > budget) continue;
      out.push(h);
      spent += h.tokens;
    }
    return out;
  }
}

// ---- helpers ---------------------------------------------------------

/** Text fed to BM25 for indexing — joins canonical names, aliases, content, and attributes. */
function indexableText(asset: AnyAsset): string {
  if (isWorldBibleEntry(asset)) {
    const parts = [
      asset.canonical_name,
      ...asset.aliases,
      asset.entity_type,
      asset.content,
      ...(asset.summary ? [asset.summary] : []),
      ...asset.attributes.map((a) => `${a.key}: ${stringify(a.value)}`),
    ];
    return parts.join("\n");
  }
  return asset.content;
}

/** Type-guard for entity cards (asset kind === ENTITY + has entity_id). */
function isWorldBibleEntry(a: AnyAsset): a is WorldBibleEntry {
  return (
    a.kind === MemoryKind.ENTITY &&
    (a as WorldBibleEntry).entity_id !== undefined
  );
}

/** Opaque turn key used to sort by recency — prefers last_updated_turn. */
function recencyKey(asset: AnyAsset): string {
  return asset.last_updated_turn ?? asset.provenance.source_turn_id;
}

/** Best-effort string rendering for attribute values during indexing. */
function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/** Normalize a scalar-or-array filter value into a readonly array (or undefined). */
function asArray<T>(v: T | readonly T[] | undefined): readonly T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? (v as readonly T[]) : ([v as T] as const);
}
