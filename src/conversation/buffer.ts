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

export class ConversationBuffer {
  private turns: Turn[] = [];
  private byId = new Map<string, Turn>();
  private highWater = 0;

  append(turn: Turn): void {
    if (this.byId.has(turn.id)) {
      throw new Error(`duplicate turn id: ${turn.id}`);
    }
    this.turns.push(turn);
    this.byId.set(turn.id, turn);
  }

  /** Total number of turns appended (processed or not). */
  size(): number {
    return this.turns.length;
  }

  get(id: string): Turn | undefined {
    return this.byId.get(id);
  }

  /** Snapshot of every turn, in insertion order. */
  all(): readonly Turn[] {
    return this.turns;
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
}
