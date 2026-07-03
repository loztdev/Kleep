/**
 * In-memory reference implementation of `PromptStore`. Plain config
 * data (no provenance, no schema validation) — much simpler than the
 * memory-asset stores.
 */

import type { PromptStore, SavedPrompt } from "./types";

export class InMemoryPromptStore implements PromptStore {
  private byId = new Map<string, SavedPrompt>();

  create(prompt: { id: string; title: string; content: string; now: number }): SavedPrompt {
    const saved: SavedPrompt = {
      id: prompt.id,
      title: prompt.title,
      content: prompt.content,
      createdAt: prompt.now,
      updatedAt: prompt.now,
    };
    this.byId.set(saved.id, saved);
    return saved;
  }

  list(): SavedPrompt[] {
    return Array.from(this.byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): SavedPrompt | undefined {
    return this.byId.get(id);
  }

  update(id: string, fields: { title: string; content: string }, now: number): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, ...fields, updatedAt: now });
  }

  delete(id: string): boolean {
    return this.byId.delete(id);
  }
}
