/**
 * StubEmbedder — deterministic, content-derived vectors for tests.
 *
 * Uses a tiny FNV-1a-style hash over character codes to produce a
 * stable vector. Identical input → identical output. Different inputs
 * almost always produce distinct vectors (collisions don't matter for
 * unit tests).
 */

import type { Embedder } from "./types";

export interface StubEmbedderOptions {
  model?: string;
  dim?: number;
}

export class StubEmbedder implements Embedder {
  readonly model: string;
  readonly dim: number;

  constructor(opts: StubEmbedderOptions = {}) {
    this.model = opts.model ?? "stub-fnv-v1";
    this.dim = opts.dim ?? 16;
  }

  embed(text: string): readonly number[] {
    const out = new Array<number>(this.dim).fill(0);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
      const slot = h % this.dim;
      // Map hash byte to [-1, 1] for cosine sanity.
      out[slot]! += ((h & 0xff) / 127.5) - 1;
    }
    return out;
  }
}
