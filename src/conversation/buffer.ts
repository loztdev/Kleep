/**
 * ConversationBuffer — append-only log of turns with a "high-water mark"
 * the AutoRetainEngine advances as it processes them.
 *
 * The buffer is intentionally simple: it doesn't know about extraction,
 * provenance, or storage. It just tracks "what's new since last tick"
 * so the engine can be re-entrant and crash-safe (resume from the
 * persisted high-water mark).
 */

import type { Turn } from "./types";

// Inline type-only alias — matches `retrieval/tokenBudget.TokenEstimator`
// without creating a cross-layer import. We intentionally don't export.
type TokenEstimator = (text: string) => number;

/** Append-only log of turns with extraction + summarization marks. */
export class ConversationBuffer {
  private turns: Turn[] = [];
  private byId = new Map<string, Turn>();
  private highWater = 0;
  /**
   * Turn ids that have been rolled up into a SUMMARY MemoryAsset by
   * Tier 3.7's RollingSummarizer. Still kept here for ordering and
   * audit; excluded from token counts and the "live window" used for
   * prompt assembly.
   */
  private summarized = new Set<string>();

  /** Add a turn to the log. Throws on duplicate id. */
  append(turn: Turn): void {
    if (this.byId.has(turn.id)) {
      throw new Error(`duplicate turn id: ${turn.id}`);
    }
    this.turns.push(turn);
    this.byId.set(turn.id, turn);
  }

  /**
   * Rebuild a buffer from persisted state (Tier 6) — appends `turns` in
   * order, then restores the high-water mark and summarized set directly
   * rather than re-deriving them, since the persisted values are already
   * known-correct and re-deriving would require re-running extraction/
   * summarization against the LLM again for no reason.
   */
  static fromPersisted(
    turns: readonly Turn[],
    opts: { processedCount?: number; summarizedTurnIds?: readonly string[] } = {},
  ): ConversationBuffer {
    const buffer = new ConversationBuffer();
    for (const turn of turns) buffer.append(turn);
    if (opts.summarizedTurnIds?.length) buffer.markSummarized(opts.summarizedTurnIds);
    if (opts.processedCount !== undefined) {
      buffer.highWater = Math.max(0, Math.min(opts.processedCount, buffer.turns.length));
    }
    return buffer;
  }

  /**
   * Reset every mutable slot: drops the turns, the id index, the
   * high-water mark, and the summarized set. Symmetric with a fresh
   * `new ConversationBuffer()` — used by the chat surface's "wipe history"
   * flow so a session's persisted state can be zeroed in place without
   * having to reconstruct the buffer inside a memoized dep chain.
   */
  clear(): void {
    this.turns = [];
    this.byId.clear();
    this.summarized.clear();
    this.highWater = 0;
  }

  /** Total number of turns appended (processed or not). */
  size(): number {
    return this.turns.length;
  }

  /** Look up a turn by id. */
  get(id: string): Turn | undefined {
    return this.byId.get(id);
  }

  /** Snapshot of every turn, in insertion order. */
  all(): readonly Turn[] {
    return this.turns;
  }

  /**
   * Remove the turn with `turnId` and every turn after it — the primitive
   * behind "edit message" and "regenerate reply" (both discard a suffix of
   * the conversation and replay from an earlier point). Returns the
   * removed turns in their original order; a no-op returning `[]` if
   * `turnId` isn't found. Clamps the high-water mark and drops any
   * `summarized` marks for the removed turns.
   */
  truncateFrom(turnId: string): Turn[] {
    const idx = this.turns.findIndex((t) => t.id === turnId);
    if (idx < 0) return [];
    const removed = this.turns.splice(idx);
    for (const t of removed) {
      this.byId.delete(t.id);
      this.summarized.delete(t.id);
    }
    if (this.highWater > this.turns.length) this.highWater = this.turns.length;
    return removed;
  }

  /** Turns appended since `markProcessed` was last called. */
  pendingTurns(): readonly Turn[] {
    return this.turns.slice(this.highWater);
  }

  /**
   * Advance the high-water mark past the given turn id. No-op if the
   * id is unknown or already behind the mark. Returns the new mark.
   */
  markProcessed(throughTurnId: string): number {
    const idx = this.turns.findIndex((t) => t.id === throughTurnId);
    if (idx < 0) return this.highWater;
    const newMark = idx + 1;
    if (newMark > this.highWater) this.highWater = newMark;
    return this.highWater;
  }

  /** Current high-water mark — index of the next pending turn. */
  processedCount(): number {
    return this.highWater;
  }

  // ---- summarization-aware helpers (Tier 3.7) -------------------------

  /** Has this turn already been rolled into a SUMMARY asset? */
  isSummarized(turnId: string): boolean {
    return this.summarized.has(turnId);
  }

  /** Mark every supplied turn id as summarized. Unknown ids are ignored. */
  markSummarized(turnIds: readonly string[]): void {
    for (const id of turnIds) {
      if (this.byId.has(id)) this.summarized.add(id);
    }
  }

  /** Turns currently visible to prompt assembly (not yet summarized). */
  liveTurns(): readonly Turn[] {
    return this.turns.filter((t) => !this.summarized.has(t.id));
  }

  /**
   * Live (non-summarized) turns strictly before `turnId` — the context a
   * "regenerate" or "edit" flow replays from. Returns `[]` if `turnId`
   * isn't found.
   */
  contextBefore(turnId: string): readonly Turn[] {
    const idx = this.turns.findIndex((t) => t.id === turnId);
    if (idx < 0) return [];
    return this.turns.slice(0, idx).filter((t) => !this.summarized.has(t.id));
  }

  /** Sum of estimated tokens over live (non-summarized) turns. */
  liveTokenCount(estimate: TokenEstimator): number {
    let total = 0;
    for (const t of this.turns) {
      if (!this.summarized.has(t.id)) total += estimate(t.content);
    }
    return total;
  }

  summarizedCount(): number {
    return this.summarized.size;
  }
}
