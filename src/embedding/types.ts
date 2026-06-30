/**
 * Embedder interface.
 *
 * The engine calls it for any LORE fact; Tier 3.6 will call it again
 * at query time to embed the user's prompt. Same interface either way.
 *
 * Production embedders (Cohere, OpenAI, on-device sentence-transformers
 * via ONNX) drop in behind this. A `StubEmbedder` exists for tests.
 */

export interface Embedder {
  /** Stable identifier — stored alongside vectors so we can refuse
   *  cross-model queries if the embedding model ever changes. */
  readonly model: string;
  /** Output dimensionality. The vector store enforces consistency. */
  readonly dim: number;

  embed(text: string): Promise<readonly number[]> | readonly number[];
}
