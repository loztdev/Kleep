/**
 * SQLite-backed `PromptStore` — same contract as `InMemoryPromptStore`,
 * verified against the identical contract test suite, just durable.
 */

import type { SqlDatabase } from "./sql/types";
import type { PromptStore, SavedPrompt, SavedPromptKind } from "./types";

interface Row {
  id: string;
  title: string;
  content: string;
  kind: string;
  created_at: number;
  updated_at: number;
}

function toSavedPrompt(row: Row): SavedPrompt {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    // Guard against a legacy row that predates migration 0003 — `NOT NULL
    // DEFAULT 'persona'` should make this impossible, but a `null` slipping
    // through would corrupt the UI's tab split silently.
    kind: (row.kind === "jailbreak" ? "jailbreak" : "persona") as SavedPromptKind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqlitePromptStore implements PromptStore {
  constructor(private readonly db: SqlDatabase) {}

  create(prompt: {
    id: string;
    title: string;
    content: string;
    kind?: SavedPromptKind;
    now: number;
  }): SavedPrompt {
    const kind = prompt.kind ?? "persona";
    this.db.runSync(
      "INSERT INTO saved_prompts (id, title, content, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [prompt.id, prompt.title, prompt.content, kind, prompt.now, prompt.now],
    );
    return {
      id: prompt.id,
      title: prompt.title,
      content: prompt.content,
      kind,
      createdAt: prompt.now,
      updatedAt: prompt.now,
    };
  }

  list(kind?: SavedPromptKind): SavedPrompt[] {
    // `id` tiebreaker keeps ordering deterministic (and consistent with
    // `InMemoryPromptStore`) when two prompts share an `updated_at` millisecond.
    const rows = kind
      ? this.db.getAllSync<Row>(
          "SELECT * FROM saved_prompts WHERE kind = ? ORDER BY updated_at DESC, id ASC",
          [kind],
        )
      : this.db.getAllSync<Row>(
          "SELECT * FROM saved_prompts ORDER BY updated_at DESC, id ASC",
          [],
        );
    return rows.map(toSavedPrompt);
  }

  get(id: string): SavedPrompt | undefined {
    const row = this.db.getFirstSync<Row>("SELECT * FROM saved_prompts WHERE id = ?", [id]);
    return row ? toSavedPrompt(row) : undefined;
  }

  update(id: string, fields: { title: string; content: string }, now: number): void {
    this.db.runSync(
      "UPDATE saved_prompts SET title = ?, content = ?, updated_at = ? WHERE id = ?",
      [fields.title, fields.content, now, id],
    );
  }

  setKind(id: string, kind: SavedPromptKind, now: number): void {
    this.db.runSync(
      "UPDATE saved_prompts SET kind = ?, updated_at = ? WHERE id = ?",
      [kind, now, id],
    );
  }

  delete(id: string): boolean {
    const result = this.db.runSync("DELETE FROM saved_prompts WHERE id = ?", [id]);
    return result.changes > 0;
  }
}
