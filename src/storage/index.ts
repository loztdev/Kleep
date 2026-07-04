/**
 * Tier 1.2: Dual-Engine Storage public surface.
 */

export type {
  PromptStore,
  SavedPrompt,
  SavedPromptKind,
  StructuredQuery,
  StructuredStore,
  VectorQueryFilter,
  VectorSearchResult,
  VectorStore,
} from "./types";
export { InMemoryPromptStore } from "./inMemoryPromptStore";
export { InMemoryStructuredStore } from "./inMemoryStructuredStore";
export { InMemoryVectorStore } from "./inMemoryVectorStore";
export { SqlitePromptStore } from "./sqlitePromptStore";
export { SqliteStructuredStore } from "./sqliteStructuredStore";
export { SqliteVectorStore } from "./sqliteVectorStore";
export type { SqlDatabase, SqlParam, SqlRunResult } from "./sql/types";
export { ChatSessionStore, type ChatSessionMeta, type LoadedSession } from "./chatSessionStore";
