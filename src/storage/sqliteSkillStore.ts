/**
 * SQLite-backed `SkillStore` — same contract as `InMemorySkillStore`,
 * verified against the identical contract test suite, just durable.
 */

import type { SqlDatabase } from "./sql/types";
import type { SavedSkill, SkillStore } from "./types";

interface Row {
  id: string;
  name: string;
  description: string;
  when_to_use: string;
  body: string;
  created_at: number;
  updated_at: number;
}

function toSavedSkill(row: Row): SavedSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    whenToUse: row.when_to_use,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteSkillStore implements SkillStore {
  constructor(private readonly db: SqlDatabase) {}

  create(skill: {
    id: string;
    name: string;
    description: string;
    whenToUse: string;
    body: string;
    now: number;
  }): SavedSkill {
    this.db.runSync(
      `INSERT INTO saved_skills (id, name, description, when_to_use, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [skill.id, skill.name, skill.description, skill.whenToUse, skill.body, skill.now, skill.now],
    );
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      body: skill.body,
      createdAt: skill.now,
      updatedAt: skill.now,
    };
  }

  list(): SavedSkill[] {
    const rows = this.db.getAllSync<Row>(
      "SELECT * FROM saved_skills ORDER BY updated_at DESC, id ASC",
      [],
    );
    return rows.map(toSavedSkill);
  }

  get(id: string): SavedSkill | undefined {
    const row = this.db.getFirstSync<Row>("SELECT * FROM saved_skills WHERE id = ?", [id]);
    return row ? toSavedSkill(row) : undefined;
  }

  update(
    id: string,
    fields: { name: string; description: string; whenToUse: string; body: string },
    now: number,
  ): void {
    this.db.runSync(
      `UPDATE saved_skills
       SET name = ?, description = ?, when_to_use = ?, body = ?, updated_at = ?
       WHERE id = ?`,
      [fields.name, fields.description, fields.whenToUse, fields.body, now, id],
    );
  }

  delete(id: string): boolean {
    const result = this.db.runSync("DELETE FROM saved_skills WHERE id = ?", [id]);
    return result.changes > 0;
  }
}
