/**
 * In-memory reference implementation of `SkillStore`. Same shape as
 * `InMemoryPromptStore`, verified against the same contract test suite
 * as `SqliteSkillStore`.
 */

import type { SavedSkill, SkillStore } from "./types";

export class InMemorySkillStore implements SkillStore {
  private byId = new Map<string, SavedSkill>();

  create(skill: {
    id: string;
    name: string;
    description: string;
    whenToUse: string;
    body: string;
    now: number;
  }): SavedSkill {
    const saved: SavedSkill = {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      body: skill.body,
      createdAt: skill.now,
      updatedAt: skill.now,
    };
    this.byId.set(saved.id, saved);
    return saved;
  }

  list(): SavedSkill[] {
    // `id` tiebreaker keeps ordering deterministic (and consistent with
    // `SqliteSkillStore`) when two skills share an `updatedAt` millisecond.
    return Array.from(this.byId.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
  }

  get(id: string): SavedSkill | undefined {
    return this.byId.get(id);
  }

  update(
    id: string,
    fields: { name: string; description: string; whenToUse: string; body: string },
    now: number,
  ): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, ...fields, updatedAt: now });
  }

  delete(id: string): boolean {
    return this.byId.delete(id);
  }
}
