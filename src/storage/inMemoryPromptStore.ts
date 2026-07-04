/**
 * In-memory reference implementation of `PromptStore`. Plain config
 * data (no provenance, no schema validation) — much simpler than the
 * memory-asset stores.
 */

import type { PromptStore, SavedPrompt, SavedPromptKind } from "./types";

export class InMemoryPromptStore implements PromptStore {
  private byId = new Map<string, SavedPrompt>();

  create(prompt: {
    id: string;
    title: string;
    content: string;
    kind?: SavedPromptKind;
    now: number;
  }): SavedPrompt {
    const saved: SavedPrompt = {
      id: prompt.id,
      title: prompt.title,
      content: prompt.content,
      kind: prompt.kind ?? "persona",
      createdAt: prompt.now,
      updatedAt: prompt.now,
    };
    this.byId.set(saved.id, saved);
    return saved;
  }

  list(kind?: SavedPromptKind): SavedPrompt[] {
    // `id` tiebreaker keeps ordering deterministic (and consistent with
    // `SqlitePromptStore`) when two prompts share an `updatedAt` millisecond.
    const all = Array.from(this.byId.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
    return kind ? all.filter((p) => p.kind === kind) : all;
  }

  get(id: string): SavedPrompt | undefined {
    return this.byId.get(id);
  }

  update(id: string, fields: { title: string; content: string }, now: number): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, ...fields, updatedAt: now });
  }

  setKind(id: string, kind: SavedPromptKind, now: number): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, kind, updatedAt: now });
  }

  delete(id: string): boolean {
    return this.byId.delete(id);
  }
}
