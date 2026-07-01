/**
 * Tier 1.2: Dual-Engine Storage public surface.
 */

export type {
  StructuredQuery,
  StructuredStore,
  VectorQueryFilter,
  VectorSearchResult,
  VectorStore,
} from "./types";
export { InMemoryStructuredStore } from "./inMemoryStructuredStore";
export { InMemoryVectorStore } from "./inMemoryVectorStore";
export { SqliteStructuredStore } from "./sqliteStructuredStore";
export { SqliteVectorStore } from "./sqliteVectorStore";
export type { SqlDatabase, SqlParam, SqlRunResult } from "./sql/types";
export { ChatSessionStore, type ChatSessionMeta, type LoadedSession } from "./chatSessionStore";
