/**
 * Persists chat sessions (the "Chats" list) and each session's turns —
 * new ground, not part of the original `StructuredStore`/`VectorStore`
 * contract (Tier 6.1/6.2), since multiple named conversation threads
 * weren't part of that design. Deliberately separate from
 * `SqliteStructuredStore`/`SqliteVectorStore`: sessions/turns are
 * per-conversation, while structured facts and lore are one continuous,
 * shared memory across every session — that's the whole point of a
 * biomimetic memory that keeps learning across conversations instead of
 * resetting per chat.
 */

import type { LlmProviderKind } from "../llm";
import { TurnRole, type Turn } from "../conversation";
import type { SqlDatabase } from "./sql/types";
import { withTransaction } from "./sql/transaction";

export interface ChatSessionMeta {
  id: string;
  title: string;
  providerKind: LlmProviderKind;
  model?: string;
  /** Per-chat system prompt override — falls back to the app default (or Kleep's built-in persona) when unset. */
  systemPrompt?: string;
  /**
   * Per-chat "jailbreak" — a permissions/behavior prompt prepended *before*
   * the persona system prompt when non-empty. Empty/unset means we send only
   * the persona (existing behavior). See `chatReply.generateReply` for how
   * the two are actually composed on the wire.
   */
  jailbreakPrompt?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LoadedSession {
  turns: Turn[];
  processedCount: number;
  summarizedTurnIds: string[];
}

interface SessionRow {
  id: string;
  title: string;
  provider_kind: string;
  model: string | null;
  system_prompt: string | null;
  jailbreak_prompt: string | null;
  created_at: number;
  updated_at: number;
  processed_count: number;
}

interface TurnRow {
  id: string;
  role: string;
  content: string;
  turn_index: number;
  summarized: number;
}

/** `{}` when `value` is falsy (empty string counts as "unset", matching `model`'s existing behavior), else `{ [key]: value }`. */
function optionalField<K extends string, V>(key: K, value: V | null | undefined): Partial<Record<K, V>> {
  return value ? ({ [key]: value } as Partial<Record<K, V>>) : {};
}

function toMeta(row: SessionRow): ChatSessionMeta {
  return {
    id: row.id,
    title: row.title,
    providerKind: row.provider_kind as LlmProviderKind,
    ...optionalField("model", row.model),
    ...optionalField("systemPrompt", row.system_prompt),
    ...optionalField("jailbreakPrompt", row.jailbreak_prompt),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** SQLite-backed store for chat sessions and their turns. */
export class ChatSessionStore {
  constructor(private readonly db: SqlDatabase) {}

  createSession(opts: {
    id: string;
    title: string;
    providerKind: LlmProviderKind;
    model?: string;
    systemPrompt?: string;
    jailbreakPrompt?: string;
    now: number;
  }): ChatSessionMeta {
    this.db.runSync(
      `INSERT INTO chat_sessions (id, title, provider_kind, model, system_prompt, jailbreak_prompt, created_at, updated_at, processed_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        opts.id,
        opts.title,
        opts.providerKind,
        opts.model ?? null,
        opts.systemPrompt ?? null,
        opts.jailbreakPrompt ?? null,
        opts.now,
        opts.now,
      ],
    );
    return {
      id: opts.id,
      title: opts.title,
      providerKind: opts.providerKind,
      ...optionalField("model", opts.model),
      ...optionalField("systemPrompt", opts.systemPrompt),
      ...optionalField("jailbreakPrompt", opts.jailbreakPrompt),
      createdAt: opts.now,
      updatedAt: opts.now,
    };
  }

  /** All sessions, most-recently-updated first. */
  listSessions(): ChatSessionMeta[] {
    const rows = this.db.getAllSync<SessionRow>(
      "SELECT * FROM chat_sessions ORDER BY updated_at DESC",
      [],
    );
    return rows.map(toMeta);
  }

  getSession(id: string): ChatSessionMeta | undefined {
    const row = this.db.getFirstSync<SessionRow>(
      "SELECT * FROM chat_sessions WHERE id = ?",
      [id],
    );
    return row ? toMeta(row) : undefined;
  }

  renameSession(id: string, title: string, now: number): void {
    this.db.runSync("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?", [
      title,
      now,
      id,
    ]);
  }

  /**
   * Corrects a session's stored provider/model metadata to match the
   * connection it's actually continuing on — doesn't touch `updated_at`,
   * since merely reopening a chat under a different connection shouldn't
   * reorder the chat list.
   */
  updateProviderMeta(id: string, providerKind: LlmProviderKind, model?: string): void {
    this.db.runSync("UPDATE chat_sessions SET provider_kind = ?, model = ? WHERE id = ?", [
      providerKind,
      model ?? null,
      id,
    ]);
  }

  /** Set (or clear, passing `undefined`) this chat's system prompt override. */
  updateSystemPrompt(id: string, systemPrompt: string | undefined, now: number): void {
    this.db.runSync(
      "UPDATE chat_sessions SET system_prompt = ?, updated_at = ? WHERE id = ?",
      [systemPrompt ?? null, now, id],
    );
  }

  /** Set (or clear, passing `undefined`) this chat's jailbreak prompt. */
  updateJailbreakPrompt(id: string, jailbreakPrompt: string | undefined, now: number): void {
    this.db.runSync(
      "UPDATE chat_sessions SET jailbreak_prompt = ?, updated_at = ? WHERE id = ?",
      [jailbreakPrompt ?? null, now, id],
    );
  }

  deleteSession(id: string): void {
    this.db.runSync("DELETE FROM chat_sessions WHERE id = ?", [id]);
    this.db.runSync("DELETE FROM chat_turns WHERE session_id = ?", [id]);
  }

  /** Every turn for a session plus enough state to rebuild a `ConversationBuffer` exactly. */
  loadSession(sessionId: string): LoadedSession {
    const rows = this.db.getAllSync<TurnRow>(
      "SELECT id, role, content, turn_index, summarized FROM chat_turns WHERE session_id = ? ORDER BY turn_index ASC",
      [sessionId],
    );
    const turns: Turn[] = rows.map((r) => ({
      id: r.id,
      role: r.role as TurnRole,
      content: r.content,
      index: r.turn_index,
    }));
    const session = this.getSession(sessionId);
    const summarizedTurnIds = rows.filter((r) => r.summarized).map((r) => r.id);
    return {
      turns,
      processedCount: session ? sessionRowProcessedCount(this.db, sessionId) : 0,
      summarizedTurnIds,
    };
  }

  appendTurn(sessionId: string, turn: Turn, now: number): void {
    this.db.runSync(
      "INSERT INTO chat_turns (id, session_id, role, content, turn_index, summarized) VALUES (?, ?, ?, ?, ?, 0)",
      [turn.id, sessionId, turn.role, turn.content, turn.index],
    );
    this.touchSession(sessionId, now);
  }

  /** Delete the given turn and every turn after it (by index) — mirrors `ConversationBuffer.truncateFrom`. */
  truncateFrom(sessionId: string, turnId: string): void {
    const target = this.db.getFirstSync<{ turn_index: number }>(
      "SELECT turn_index FROM chat_turns WHERE session_id = ? AND id = ?",
      [sessionId, turnId],
    );
    if (!target) return;
    this.db.runSync(
      "DELETE FROM chat_turns WHERE session_id = ? AND turn_index >= ?",
      [sessionId, target.turn_index],
    );
  }

  /**
   * Truncate from `turnId` and insert `newTurns` in its place, all in one
   * transaction — the durable half of "regenerate"/"edit" (both discard a
   * suffix and replay from an earlier point). Callers persist this *before*
   * mutating `ConversationBuffer` so a failed write never leaves the
   * in-memory transcript ahead of what's actually saved.
   */
  replaceFrom(sessionId: string, turnId: string, newTurns: readonly Turn[], now: number): void {
    withTransaction(this.db, () => {
      const target = this.db.getFirstSync<{ turn_index: number }>(
        "SELECT turn_index FROM chat_turns WHERE session_id = ? AND id = ?",
        [sessionId, turnId],
      );
      if (target) {
        this.db.runSync("DELETE FROM chat_turns WHERE session_id = ? AND turn_index >= ?", [
          sessionId,
          target.turn_index,
        ]);
      }
      for (const turn of newTurns) {
        this.db.runSync(
          "INSERT INTO chat_turns (id, session_id, role, content, turn_index, summarized) VALUES (?, ?, ?, ?, ?, 0)",
          [turn.id, sessionId, turn.role, turn.content, turn.index],
        );
      }
      this.db.runSync("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", [now, sessionId]);
    });
  }

  /**
   * Wipe every turn from a session and reset its extraction/summary state
   * without touching the session row itself (title, prompts, provider
   * meta all stay). The chat surface uses this to break "in-context
   * refusal locking" — where prior assistant turns pattern-match the
   * model into continuing to refuse — by handing the session a clean
   * transcript to work from. Kept as one transaction so a mid-write
   * crash can't leave orphaned turns behind a reset `processed_count`.
   * The shared memory stores (`structured`/`vector`) are deliberately
   * untouched: they carry cross-session context that predates the
   * session and shouldn't get flushed by a chat-scoped reset.
   */
  clearTurns(sessionId: string, now: number): void {
    withTransaction(this.db, () => {
      this.db.runSync("DELETE FROM chat_turns WHERE session_id = ?", [sessionId]);
      this.db.runSync(
        "UPDATE chat_sessions SET processed_count = 0, updated_at = ? WHERE id = ?",
        [now, sessionId],
      );
    });
  }

  updateProcessedCount(sessionId: string, count: number): void {
    this.db.runSync("UPDATE chat_sessions SET processed_count = ? WHERE id = ?", [
      count,
      sessionId,
    ]);
  }

  markSummarized(sessionId: string, turnIds: readonly string[]): void {
    if (turnIds.length === 0) return;
    const placeholders = turnIds.map(() => "?").join(", ");
    this.db.runSync(
      `UPDATE chat_turns SET summarized = 1 WHERE session_id = ? AND id IN (${placeholders})`,
      [sessionId, ...turnIds],
    );
  }

  touchSession(sessionId: string, now: number): void {
    this.db.runSync("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", [now, sessionId]);
  }
}

function sessionRowProcessedCount(db: SqlDatabase, sessionId: string): number {
  const row = db.getFirstSync<{ processed_count: number }>(
    "SELECT processed_count FROM chat_sessions WHERE id = ?",
    [sessionId],
  );
  return row?.processed_count ?? 0;
}
