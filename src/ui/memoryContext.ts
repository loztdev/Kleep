/**
 * Assemble a compact "memory context" block for the chat surface's system
 * prompt. Called once per reply (send / regenerate / edit) with the
 * user turn that triggered the reply as the recall query.
 *
 * The block has two layers:
 *
 *   1. "Story so far" — the N most recent `SUMMARY` assets, in
 *      chronological order. Guarantees the model sees whatever the
 *      rolling summarizer swallowed out of `liveTurns()`.
 *   2. "Relevant memories" — top-scored `FACT` / `OBSERVATION` / `RULE` /
 *      `LORE` / `OPINION` assets from the fusion recall engine, keyed
 *      off the query text. Deduped against Layer 1 by id.
 *
 * If both layers are empty, returns `undefined` so the caller can skip
 * the "no context to show" line entirely rather than injecting a dead
 * header. Total content is trimmed to a soft token budget so a
 * runaway-large corpus can't blow past the model's system-prompt sweet
 * spot.
 */

import type { ConversationBuffer } from "../conversation";
import type { AnyAsset } from "../ingest";
import type { FusionRecallEngine } from "../retrieval";
import { estimateTokensByChars, type TokenEstimator } from "../retrieval/tokenBudget";
import { MemoryKind, type MemoryAsset } from "../schema";
import type { StructuredStore } from "../storage";

/** Kinds worth surfacing under "Relevant memories" (SUMMARY handled separately, ENTITY skipped for MVP). */
const RELEVANT_KINDS: readonly MemoryKind[] = [
  MemoryKind.FACT,
  MemoryKind.RULE,
  MemoryKind.LORE,
  MemoryKind.OPINION,
  MemoryKind.REFLECTION,
];

export interface AssembleMemoryContextOptions {
  structured: StructuredStore;
  fusion: FusionRecallEngine;
  buffer: ConversationBuffer;
  /** The user turn that triggered this reply — its content is the recall query. */
  query: string;
  /** Max number of "story so far" summaries to include. Default 3. */
  maxSummaries?: number;
  /** Max number of "relevant memories" entries. Default 10. */
  maxRecalled?: number;
  /** Soft token budget for the whole block. Default 2000. */
  tokenBudget?: number;
  /** Token estimator; defaults to chars/4. */
  estimateTokens?: TokenEstimator;
}

/**
 * Build the memory context string, or `undefined` if neither layer
 * produced anything.
 */
export async function assembleMemoryContext(
  opts: AssembleMemoryContextOptions,
): Promise<string | undefined> {
  const estimateTokens = opts.estimateTokens ?? estimateTokensByChars;
  const maxSummaries = opts.maxSummaries ?? 3;
  const maxRecalled = opts.maxRecalled ?? 10;
  const tokenBudget = opts.tokenBudget ?? 2000;

  const summaries = recentSummaries(opts.structured, opts.buffer, maxSummaries);
  // Recall runs even when the query is short — the fusion engine's
  // chronological + entity channels can still fire off a lone name.
  const recalled = opts.query.trim().length > 0
    ? await opts.fusion.recall(opts.query, {
        topK: maxRecalled,
        tokenBudget,
      })
    : [];

  const seen = new Set(summaries.map((s) => s.id));
  const relevant: AnyAsset[] = [];
  for (const hit of recalled) {
    if (seen.has(hit.asset.id)) continue;
    // Only show kinds we know how to render as short bullets.
    if (hit.asset.kind === MemoryKind.SUMMARY) continue;
    if (!RELEVANT_KINDS.includes(hit.asset.kind as MemoryKind)) continue;
    seen.add(hit.asset.id);
    relevant.push(hit.asset);
  }

  if (summaries.length === 0 && relevant.length === 0) return undefined;

  const parts: string[] = [];
  if (summaries.length > 0) {
    parts.push("## Story so far\n\n" + summaries.map((s) => s.content.trim()).join("\n\n"));
  }
  if (relevant.length > 0) {
    parts.push(
      "## Relevant memories\n\n" +
        relevant.map((a) => `- ${a.content.trim()}`).join("\n"),
    );
  }
  const block = "# Memory context\n\n" + parts.join("\n\n");

  // One last trim in case the summaries alone busted the budget.
  return trimToTokenBudget(block, tokenBudget, estimateTokens);
}

/**
 * The N most recent SUMMARY assets, in chronological order (oldest →
 * newest), keyed off `buffer.all()`'s insertion order via each
 * summary's `temporal_range.turn_end`. Assets whose anchor turn is no
 * longer in the buffer are dropped — a truncated/regenerated tail can
 * strand an old summary that describes turns that no longer exist.
 */
function recentSummaries(
  structured: StructuredStore,
  buffer: ConversationBuffer,
  maxSummaries: number,
): MemoryAsset[] {
  if (maxSummaries <= 0) return [];
  // Buffer order → position map for a fast index lookup during sort.
  const positionByTurnId = new Map<string, number>();
  const allTurns = buffer.all();
  for (let i = 0; i < allTurns.length; i++) positionByTurnId.set(allTurns[i]!.id, i);

  const rawSummaries = structured.query({ kind: MemoryKind.SUMMARY });
  const memorySummaries: Array<{ asset: MemoryAsset; pos: number }> = [];
  for (const asset of rawSummaries) {
    // WorldBibleEntry never has kind SUMMARY, but query() returns the
    // union type — narrow here so callers don't have to.
    if (asset.kind !== MemoryKind.SUMMARY) continue;
    const anchorTurnId =
      asset.provenance.temporal_range?.turn_end ?? asset.provenance.source_turn_id;
    const pos = positionByTurnId.get(anchorTurnId);
    if (pos === undefined) continue;
    memorySummaries.push({ asset: asset as MemoryAsset, pos });
  }
  memorySummaries.sort((a, b) => a.pos - b.pos);
  return memorySummaries.slice(-maxSummaries).map((s) => s.asset);
}

/**
 * If `text` fits `budget`, return it as-is. Otherwise cut whole lines
 * off the end until it fits — never truncate mid-sentence. Guarantees
 * a non-empty output when the input is non-empty (the top-level
 * `# Memory context` header alone is a couple of tokens).
 */
function trimToTokenBudget(
  text: string,
  budget: number,
  estimateTokens: TokenEstimator,
): string {
  if (estimateTokens(text) <= budget) return text;
  const lines = text.split("\n");
  while (lines.length > 1 && estimateTokens(lines.join("\n")) > budget) {
    lines.pop();
  }
  return lines.join("\n");
}
